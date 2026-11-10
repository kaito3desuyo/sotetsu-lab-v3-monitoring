# M19 障害の見張り（全体と monitoring リポ）設計

2026-11-10。ロードマップ M19（infrastructure・client の roadmap.md）の前半。client の「エラーの記録の直し」は別の設計で扱う。

## なぜ

登録制（2026-11-06）で書き込みの経路が増えたのに、本番が落ちても誰も気づけない。2026-10-14 のログイン障害（backend login の Errors が 1 時間に最大 11 件）は、丸一日気づかれなかった。

## 目標・非目標・やってはいけないこと

- 目標：本番の Lambda が壊れたら、**数時間以内に**ユーザーが気づける（ユーザーの言葉）。
- 非目標：
  - 分単位の速さ
  - 夜中に起こすこと（夜中に鳴ったら Discord に残り、朝に見ればよい）
  - 外からの死活監視（Route 53 ヘルスチェック・Synthetics・UptimeRobot など）。ユーザーが「いらない」と決めた
  - client（ブラウザ）のエラーを通知すること。GA の記録を読めるようにするだけで、別の設計で扱う
  - dev・stg の見張り
- やってはいけないこと：**どうでもいい知らせを混ぜること**。混ざるとユーザーは通知を切る。これが一番の掟。鳴った知らせは、どれも「見に行く価値がある」ものでなければならない。

## 決まっていること（ユーザーが決めた）

- 通知先は Discord。メールでは気づかない。
- Terraform では書かない。infrastructure リポ（Terraform）には触らない（2026-06-11「そのままにしておく」）。
- SNS トピックと Discord への転送 Lambda は、新しいリポ `sotetsu-lab-v3-monitoring` に AWS CDK（TypeScript）で書く。
- アラームは各アプリのリポ（api・backend・socket・client）の `serverless.ts` に書く。関数の定義の隣にあるほうが直し忘れない。
- api は、UUID の形でない値を DB に渡す前に 400 で返す（下の「実測」を参照）。
- client の `calendarId=undefined` 送信は、client のエラーの記録の直し（M19 後半）で直す。

## 実測（2026-10-11〜11-10・30 日・本番）

数字とスクリプトは `sotetsu-lab-v3/.context/m19-2026-11-10/`（git 管理外）。

- 本番の関数は 13 本で、すべて ap-northeast-1 にある。
  - api：`sotetsu-lab-v3-prod-api-lambda`（関数 URL・timeout 3 秒）
  - client：`-prod-client-ssr-lambda`（関数 URL・timeout 20 秒）
  - backend 6 本（API Gateway REST）：`-prod-backend-{get-maintenance,register-user,login,logout,get-auth-token,get-user-profile}-lambda`
  - socket 5 本（API Gateway WebSocket）：`-prod-socket-{connect,disconnect,send-sighting,authorizer,broadcast}-lambda`
- 本物の障害は 10/14 のログインだけ。backend login の Errors が 1 時間に 3 件以上だったのは 6 時間で、最初は 10/14 17 時（11 件）。
- api の関数 URL の 5xx（`Url5xxCount`）が 1 時間に 5 件以上だったのは 5 時間。**5 時間とも障害ではない**。UUID でない値がそのまま SQL に渡り、`QueryFailedError: invalid input syntax for type uuid` で 500 になっていた。
  - 10/21 9〜10 時：`Python-urllib` のスクリプト
  - 10/26 17 時：`node` のスクリプト（`not-a-uuid` を総当たり）
  - 11/6 11 時・11/7 20 時：本物の利用者。client が `/v3/trip-blocks?calendarId=undefined` を送っていた
- api の Errors は 10/20 16 時に 7 件あるが、ログに `ERROR` も `Task timed out` も無く、正体は分かっていない。
- SSR・socket・残りの backend は、30 日間 Errors 0、5xx 0、Throttles 0。

## 全体の形

```
各アプリの serverless.ts の CloudWatch アラーム（本番だけ）
   │ ALARM / OK のとき
   ▼
SNS トピック（monitoring）
   ▼
Discord 転送 Lambda（monitoring）── Webhook URL は SSM SecureString
   ▼
Discord のチャンネル
```

- monitoring は、トピックの ARN を SSM パラメータに書く。各アプリは `${ssm:<名前>}` でデプロイ時に読み、アラームの `AlarmActions` と `OKActions` に入れる。
  - CloudFormation の Export/ImportValue は使わない。アプリ側が import している間は monitoring 側でトピックを作り直せなくなるからだ。
- デプロイの順番は monitoring → 各アプリ。SSM パラメータが無いと、アプリのデプロイは落ちる。

## monitoring リポの中身

- CDK アプリ（TypeScript）とスタック 1 つ。中身は次のとおり。
  - SNS トピック
  - Discord 転送 Lambda（Node.js・arm64）と、トピックからの購読
  - SSM パラメータ（トピックの ARN）
- 転送 Lambda の役目：
  - SNS で届いた CloudWatch アラームの JSON から、次を Discord の Webhook に 1 通で送る。
    - アラーム名
    - 状態（ALARM＝鳴った／OK＝直った）
    - 理由（`NewStateReason`）
    - 時刻（JST）
    - そのアラームを開く CloudWatch コンソールの URL
  - 文面は日本語。鳴ったのか直ったのかが一目で分かること。
  - Discord への送信が失敗したら、Lambda 自身をエラーで終わらせる。SNS の再送に任せる。
  - Webhook URL はコードにもテンプレートにも書かない。SSM SecureString から読む。SecureString は CloudFormation で作れないので、ユーザーが手で入れる。手順は README に書く。
- 転送 Lambda 自身が壊れたことには気づけない。これは受け入れる。そのぶん部品は小さく保ち、README にテストの送り方（`aws sns publish` やアラームの状態を手で変える `aws cloudwatch set-alarm-state`）を書く。
- **CDK アプリは ESM で動かす**（ユーザーの言葉）。`package.json` に `"type": "module"` を書き、`cdk.json` の `app` は TS を ESM のまま流せる道具（`tsx` など）で起動する。
- **転送 Lambda も TypeScript で書き、`@mrgrain/cdk-esbuild` で束ねる**（ユーザーの言葉。以前の CDK でも使っていた）。`lambda.Function` の `code` に `TypeScriptCode` を渡し、`buildOptions` で ESM（`format: 'esm'`）にする。2026-11-10 時点の最新は 5.8.5（2026-10-01 更新・peer は `aws-cdk-lib ^2.51.0`・`constructs ^10.5.0`、npm で確かめた）。ESM の出力とハンドラ名（`.mjs` にするか、`package.json` の `type` で済ませるか）の組み方は builder に任せる。CDK 付属の `NodejsFunction` は使わない。
- **Lambda レイヤーは作らない**（私の判断）。転送 Lambda は Node.js 標準の `fetch` だけで書け、外の依存が無い。依存が増えても `TypeScriptCode` が esbuild で一緒に束ねる。ユーザーが以前に使っていた「レイヤーを作ってアップロードするスクリプト」は、ここでは要らない。
- **stage の切り替えは、ほかのリポと同じ形にする**（ユーザー決定・2026-11-10）。
  - context の `STAGE`（`cdk deploy -c STAGE=prod`）で stage を選び、dotenv で `.env.<stage>` を読む。
  - `.env.*` は git に入れない。CI では GitHub の environment の Secrets から書き出す（backend の `deploy-on-push-version-tags.yml` の形）。こうすると、stage ごとの値と、デプロイの決まり（誰がいつ流せるか）を、GitHub の environment ごとに分けて持てる。値をコードに書く形（CDK 公式の推し）は、ここで合わなかった。
  - 環境変数を読むのは `bin/` の入口だけにする。スタックとコンストラクトは props で値を受け、`process.env` を読まない（CDK の best practices「Configure with properties, not environment variables」の、入口で読むのは許される範囲）。
  - `STAGE` が無いとき、または知らない値のときは、synth の時点で落とす。
  - Webhook URL は `.env` にも入れない。SSM SecureString に置き、`.env` には名前も書かない（名前はコードに書く）。
  - 今は本番しか見張らないので、`.env.prod` だけを用意する。
- デプロイは手元から `cdk deploy` で行う（aws-vault）。CI は作らない。
- `cdk bootstrap`（ap-northeast-1）が一度要る。
- 最初の ADR に「Terraform でなく CDK を選んだ理由」と「アラームはアプリ側に置く理由」を書く。

## アラーム（各アプリのリポ）

共通のきまり：

- 本番（`stage === 'prod'`）だけに作る。backend・socket・client は stage を切り替えるので、CloudFormation の Condition か serverless.ts の分岐で外す。
- 期間は 1 時間（`Period: 3600`・1 データポイント）、`Statistic: Sum`。
- `TreatMissingData: notBreaching`。
- `AlarmActions` と `OKActions` の両方に SNS トピックを入れる。鳴ったときと直ったときに 1 回ずつ届く。
- アラーム名は `sotetsu-lab-v3-prod-<役目>-<何を>` の形にそろえる。Discord の文面でどれか分かるように。

各リポのアラームの目安：

| リポ | 対象 | メトリクス | しきい値（1 時間） |
|---|---|---|---|
| api | api-lambda | `Url5xxCount` | 5 件以上 |
| api | api-lambda | `Errors` | 3 件以上 |
| backend | 6 本それぞれ | `Errors` | 3 件以上 |
| socket | 5 本それぞれ | `Errors` | 3 件以上 |
| client | ssr-lambda | `Url5xxCount` | 5 件以上 |
| client | ssr-lambda | `Errors` | 3 件以上 |

- Lambda のタイムアウトは `Errors` に数えられる（ロードマップの「タイムアウト」はこれで拾う）。
- api の `Errors` は、応答で 500 を返した分を数えない。だから api は `Url5xxCount` も見る。
- 数は 15 本。費用は 1 本あたり月 $0.10 の見込み（標準解像度。私の知識で、計画のときに料金表で確かめる）。

## api の 400 化

- UUID の形でない値が、パスでもクエリでも DB に届く前に 400 で返ること。
- 少なくとも 30 日で実際に来た経路は塞ぐ。
  - `/v3/trip-blocks?calendarId=`
  - `/v3/calendars/:id`
  - `/v3/operations/calendar/:id`（`/trips` を含む）
  - 10/26 の総当たりで出た各 `:id`
- 塞ぎ方（足りない DTO に `@IsUUID()` を足すか、`QueryFailedError` の `22P02` を 400 に変える網を張るか、その両方か）は builder に任せる。どちらにしても、取りこぼしが 500 に戻らないこと。
- この直しを出してからアラームを入れる。順番を逆にすると、また空振りで鳴る。

## builder に任せること

- CDK のバージョンと書き方、転送 Lambda の作り（依存なしの `fetch` でよい）
- SSM パラメータ名（`/sotetsu-lab-v3/monitoring/...` のようにそろえる）
- Discord の文面の細かいところ（Embed にするかどうか）

## 作る側の読み合わせで決めたこと（私の判断）

- **通知先は SNS トピック 1 本・Discord のチャンネル 1 つ**。鳴った知らせも直った知らせも同じチャンネルに出す。1 時間の粒度なので、1 回の障害で届くのは「鳴った」と「直った」の 2 通で、それが狙いどおりの形だ。鳴ったり直ったりを何度も繰り返すようなら、しきい値か期間を見直す。
- **SNS の ARN を読むのは本番のデプロイだけ**。backend・socket・client は、serverless.ts で stage が `prod` のときだけ `${ssm:...}` を読み、アラームも作らない。monitoring は dev・stg 向けのパラメータを作らない。
- **アラームを作る小さな関数は、各リポに複製して持つ**。共通のパッケージにはしない。4 リポで依存を増やすほどの量ではない。しきい値と名前のずれは、この設計書の表を正とする。
- **api の 400 化は、DTO の `@IsUUID()` と `22P02` を 400 にする網の両方を入れる**。DTO は今ある経路の入口で弾くため、網は将来の経路の取りこぼしを拾うため。網は `22P02` だけを 400 にし、それ以外の `QueryFailedError` は今までどおり 500 にする。e2e テストは、実測で来た経路を列挙して書く。

## 私（Claude）の判断で決めたこと

- リポ名 `sotetsu-lab-v3-monitoring`
- SSM 経由のつなぎ方（Export/ImportValue にしない）
- しきい値（上の表）。30 日の実測で、10/14 は鳴り、api の空振りは 400 化で消える見込み
- 見るのは本番だけ
- 転送 Lambda の故障は見張らない
- 手元からのデプロイで CI を作らない

## 終わりの条件

- `aws cloudwatch set-alarm-state` でアラームを ALARM にすると Discord に 1 通、OK に戻すともう 1 通届く。各アプリのアラームを 1 本ずつ確かめる。
- api に UUID でない値を送ると 400 が返る（ログに `QueryFailedError` が出ない）。
- 本番の 15 本のアラームが `OK` か `INSUFFICIENT_DATA` で落ち着いている。

## 各リポの設計

- api：`sotetsu-lab-v3-api/docs/superpowers/specs/2026-11-10-m19-monitoring-design.md`
- backend・socket・client：それぞれの `docs/superpowers/specs/2026-11-10-m19-monitoring-design.md`
