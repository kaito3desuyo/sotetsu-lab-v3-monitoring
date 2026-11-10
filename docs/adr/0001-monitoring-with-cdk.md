# ADR-0001: 見張りの共通部分を CDK で書き、アラームはアプリ側に置く

- 日付：2026-11-10
- 状態：採用
- 設計：`docs/superpowers/specs/2026-11-10-m19-monitoring-design.md`

## 背景

登録制で書き込みの経路が増えたのに、本番が落ちても誰も気づけない。2026-10-14 のログイン障害は丸一日気づかれなかった。本番の Lambda が壊れたら、数時間以内にユーザーが気づけるようにしたい（M19）。通知先は Discord。メールでは気づかない。

## 決定

### 1. Terraform でなく CDK（TypeScript）で書く

- infrastructure リポの Terraform は 2026-06-11 に「そのままにしておく」と決めた。凍結しており、触らない。
- SNS トピックと転送 Lambda は新しいリポ `sotetsu-lab-v3-monitoring` に置く。言語は、ユーザーが選んだ TypeScript の AWS CDK。

### 2. アラームは各アプリのリポの `serverless.ts` に置く

- 関数の定義の隣にあるほうが、関数を足したり名前を変えたりしたときに直し忘れない。
- monitoring リポが持つのは SNS トピック・転送 Lambda・ARN の SSM パラメータだけ。
- アラームを作る小さな関数は、各リポに複製して持つ。共通パッケージにはしない。4 リポで依存を増やすほどの量ではない。しきい値と名前のずれは、設計書の表を正とする。

### 3. stage は context＋dotenv で選ぶ

- `cdk deploy -c STAGE=prod` で stage を選び、`bin/` の入口だけが dotenv で `.env.<stage>` を読む。ほかのリポと同じ形。
- こうすると、stage ごとの値とデプロイの決まり（誰がいつ流せるか）を、GitHub の environment ごとに分けて持てる。`.env.*` は git に入れず、CI では environment の Secrets から書き出す。
- 値をコードに書く形（CDK 公式の推し）は、この分け方に合わなかった。
- スタックとコンストラクトは props で値を受け、`process.env` を読まない。`STAGE` が無い・知らない値なら synth で落とす。
- Webhook URL は `.env` にも入れない。SSM SecureString に置く。

### 4. つなぎは SSM パラメータにする（Export/ImportValue にしない）

- monitoring はトピックの ARN を SSM パラメータ `sotetsu-lab-v3-prod-monitoring-alarm-topic-arn` に書く。各アプリは `${ssm:...}` でデプロイ時に読む。
- CloudFormation の Export/ImportValue だと、アプリ側が import している間は monitoring 側でトピックを作り直せなくなる。
- そのかわり、デプロイの順番は monitoring → 各アプリ になる。パラメータが無いと、アプリのデプロイは落ちる。

### 5. 転送 Lambda は `@mrgrain/cdk-esbuild` で束ねる

- ユーザーの希望。以前の CDK でも使っていた。CDK 付属の `NodejsFunction` は使わない。
- CDK アプリは ESM（`"type": "module"`）。`cdk.json` の `app` は `tsx` で起動する。テンプレートの `ts-node` と jest は、ESM のため `tsx` と Vitest に替えた。
- 出力は `outfile: 'index.mjs'`、ハンドラは `index.handler`。`.mjs` にして ESM を明示する。
- AWS SDK（`@aws-sdk/client-ssm`）は Lambda レイヤーで渡し、束ねでは `external` のままにする。ランタイムに同梱の SDK は、最新の版である保証が無いため、自前の版をレイヤーに入れる（2026-11-10 ユーザー決定。同日、束ねる案から訂正）。Lambda のコードは約 4 KB。

### 6. Lambda レイヤーの仕組みを土台に入れる

- ユーザーの希望（「絶対ラムダレイヤーの仕組みはあとでいる」）。以前の実装（Qiita「AWS CDKのILocalBundlingでLambda FunctionとLayerを構築する」ryo0301）を土台にし、次の 4 点を直した。
  - ソースは `src/functions`。レイヤーの依存は `src/functions/package.json` に書く。
  - アーキテクチャは arm64 だけ。
  - `bundle.sh` は `set -euo pipefail`。
  - Node は 24。
- さらに、アセットのハッシュを `package.json` と `package-lock.json` だけから取る（カスタムハッシュ）。同じディレクトリのコードを直してもレイヤーを作り直さない。
- 本番のスタックはこのレイヤーを使う。転送 Lambda の SDK（`@aws-sdk/client-ssm`、`src/functions/package.json` の `dependencies`）をレイヤーで渡す。レイヤー名は `sotetsu-lab-v3-prod-monitoring-dependencies-layer`。
- 未確認：ESM の Lambda がレイヤーの依存を素の名前で import できるか。初回のデプロイで実物で確かめる。

### 7. そのほか

- 通知先は SNS トピック 1 本・Discord のチャンネル 1 つ。障害発生の知らせも復旧の知らせも同じチャンネルに出す。
- 見るのは本番だけ。デプロイは手元から `cdk deploy`（aws-vault）で行い、CI は作らない。
- 転送 Lambda 自身の故障は見張らない。部品を小さく保ち、README にテストの送り方を書く。

### 8. AWS のリソース名は `lib/config.ts` で一括管理する

- スタック名・トピック・Lambda・ロググループ・レイヤー・SSM パラメータの名前は、`lib/config.ts` の `resourceNames()` だけで決める（2026-11-10 ユーザー決定）。スタックと `bin/` は `config.resourceNames` を読むだけで、名前を組み立てない。
- 名前はすべて `sotetsu-lab-v3-<stage>-monitoring-` で始め、stage を入れる（SSM パラメータ名も）。スタック名の末尾は `-cfn-stack`（2026-11-10 ユーザー決定）。
- 各アプリは `${ssm:sotetsu-lab-v3-${sls:stage}-monitoring-alarm-topic-arn, ''}` で、自分の stage のトピックを読む。
- 名前を変えるときは、ここと `test/config.test.ts` を直す。SSM パラメータ名を変えるなら、各アプリの `serverless-alarms.ts` も合わせる。
- 2026-11-10 にスタック名と SSM パラメータ名をこの形に改めたため、初回の `sotetsu-lab-v3-prod-monitoring-cfstack` を消してから作り直した。

## 結果

- 良い点：アラームが関数の隣にある。monitoring の作り直しがアプリの import に縛られない。stage ごとの値とデプロイの決まりを GitHub の environment で分けられる。
- 悪い点：デプロイの順番を守る必要がある。転送 Lambda の故障には気づけない。アラームを作る関数が 4 リポに複製される。
- 残る確認：ESM の Lambda からレイヤーの依存を素の名前で import できるか（上の 6）。初回のデプロイで確かめる。
