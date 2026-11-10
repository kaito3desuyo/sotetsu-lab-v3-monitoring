# sotetsu-lab-v3-monitoring

ロードマップ M19「障害の見張り」の共通部分を持つリポ。AWS CDK（TypeScript・ESM）で書く。

本番の Lambda が壊れたとき、CloudWatch アラームから Discord に知らせる。アラーム本体は各アプリのリポ（api・backend・socket・client）の `serverless.ts` に置く。このリポが持つのは次の 3 つだけ。

- SNS トピック（`sotetsu-lab-v3-prod-monitoring-alarm-topic`）
- Discord への転送 Lambda（`sotetsu-lab-v3-prod-monitoring-discord-notifier-lambda`）
- トピックの ARN を書いた SSM パラメータ（`sotetsu-lab-v3-prod-monitoring-alarm-topic-arn`）

スタック名は `sotetsu-lab-v3-prod-monitoring-cfn-stack`。設計は `docs/superpowers/specs/2026-11-10-m19-monitoring-design.md`、決定の理由は `docs/adr/` にある。

```
各アプリのアラーム → SNS トピック → 転送 Lambda → Discord
```

## 準備

Node は `mise.toml` のとおり（24）。

```
mise install
npm ci
```

## `.env.prod` を作る

`.env.example` を写して値を入れる。`.env.*` は git に入れない。

```
cp .env.example .env.prod
```

| キー | 中身 |
|---|---|
| `ACCOUNT_ID` | AWS のアカウント ID |
| `REGION` | `ap-northeast-1` |

Webhook URL は `.env` に入れない。次の「Webhook URL を入れる」で SSM に置く。

stage は `-c STAGE=prod` で選ぶ。`bin/monitoring.ts` が `.env.prod` を読む。`STAGE` が無い、または `prod` 以外なら synth で落ちる。

## 初回だけ：bootstrap

ap-northeast-1 で一度だけ要る。

```
aws-vault exec administrator -- npx cdk bootstrap aws://442730633672/ap-northeast-1
```

## Webhook URL を入れる

SecureString は CloudFormation で作れない。デプロイの前に手で入れる。

1. Discord で通知を受けたいチャンネルを開く。
2. 「チャンネルの編集 → 連携サービス → ウェブフック」で Webhook を作り、URL をコピーする。
3. SSM に入れる。

```
aws-vault exec administrator -- aws ssm put-parameter \
  --name sotetsu-lab-v3-prod-monitoring-discord-webhook-url \
  --type SecureString \
  --value <Webhook の URL>
```

URL をコード・テンプレート・`.env`・コミットに書かない。入れ直すときは `--overwrite` を付ける。

## npm スクリプト

| コマンド | 中身 |
|---|---|
| `npm test` | Vitest でテストを流す |
| `npm run synth:prod` | テンプレートを作る（手元だけ。AWS は触らない） |
| `npm run diff:prod` | デプロイ済みとの差を見る |
| `npm run deploy:prod` | デプロイする |

AWS に触るものは aws-vault 越しに流す。

```
aws-vault exec administrator -- npm run diff:prod
aws-vault exec administrator -- npm run deploy:prod
```

MFA が要るときは `--mfa-token=NNNNNN` を付ける。

デプロイの順番は **monitoring → 各アプリ**。各アプリは `${ssm:sotetsu-lab-v3-${sls:stage}-monitoring-alarm-topic-arn}` をデプロイ時に読む。monitoring より先にアプリをデプロイすると落ちる。確かめるには次を流す。

```
aws-vault exec administrator -- aws ssm get-parameter --name sotetsu-lab-v3-prod-monitoring-alarm-topic-arn
```

## 動作の確かめ方（テストの送り方）

転送 Lambda 自身が壊れたことには気づけない。デプロイしたら、次で届くか確かめる。

### SNS に直接送る

CloudWatch の JSON でないメッセージは、そのままの文字で Discord に出る。

```
aws-vault exec administrator -- aws sns publish --topic-arn <トピックの ARN> --message テスト
```

`<トピックの ARN>` は上の `ssm get-parameter` で取れる。

### アラームの状態を手で変える

各アプリのアラームを 1 本ずつ確かめるのに使う。

```
aws-vault exec administrator -- aws cloudwatch set-alarm-state \
  --alarm-name <アラーム名> --state-value ALARM --state-reason テスト
aws-vault exec administrator -- aws cloudwatch set-alarm-state \
  --alarm-name <アラーム名> --state-value OK --state-reason テスト
```

Discord には ALARM のとき「🔴 鳴った: <アラーム名>」、OK のとき「🟢 直った: <アラーム名>」が 1 通ずつ届く。`INSUFFICIENT_DATA` は送らない。

### 届かないとき

転送 Lambda のログ `/aws/lambda/sotetsu-lab-v3-prod-monitoring-discord-notifier-lambda` を見る。Discord への送信に失敗すると Lambda 自身がエラーで終わり、SNS が再送する。

## Lambda レイヤーの仕組み

依存を持つ Lambda が将来できたときのために、仕組みだけ入れてある。転送 Lambda は依存ゼロなので、**本番のスタックはまだレイヤーを使っていない**。

- `lib/layers/dependencies-layer.ts`：`DependenciesLayer` コンストラクト。`.layer`（`lambda.LayerVersion`）と `.externals`（`src/functions/package.json` の `dependencies` のキー）を持つ。
- `lib/layers/local-bundler.ts`・`lib/layers/bundle.sh`：手元で `npm ci --omit=dev --cpu=arm64 --os=linux` を `<出力>/nodejs/` に流す。手元で失敗したら `linux/arm64` の Docker に切り替わる。
- レイヤーに入れる依存は `src/functions/package.json` の `dependencies` に書く（ルートの `package.json` は CDK と開発用）。
- アセットのハッシュは `package.json` と `package-lock.json` だけから取る。同じディレクトリの Lambda のコードを直してもレイヤーは作り直されない。

使うとき：

1. `src/functions/package.json` に依存を足し、`package-lock.json` を作る（`npm install --prefix src/functions`）。
2. スタックで `new DependenciesLayer(this, 'Dependencies', { sourceDir: 'src/functions', layerVersionName })` を作る。
3. Lambda の `layers` に `.layer` を入れ、`TypeScriptCode` の `buildOptions.external` に `.externals` を渡す（`@aws-sdk/*` が要るなら呼び側で足す）。

**未確認**：ESM の Lambda が、レイヤーの `/opt/nodejs/node_modules` にある依存を素の名前で import できるか。Node の ESM は `NODE_PATH` を見ない。api は自前の `register-node-path.js` で回避している。マネージドランタイムのハンドラーで要るかどうかは確かめていない。初めてレイヤーを使うときに実物で確かめ、要るなら回避策をこの仕組みに足す。
