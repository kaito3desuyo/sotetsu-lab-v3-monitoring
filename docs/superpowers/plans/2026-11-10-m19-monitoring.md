# M19 監視の受け口（monitoring リポ）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CloudWatch アラームの通知を SNS で受け、Discord に 1 通ずつ流す CDK アプリを新しいリポに作る。

**Architecture:** CDK（TypeScript・ESM）のスタック 1 つに、SNS トピック、Discord 転送 Lambda（TS を `@mrgrain/cdk-esbuild` で束ねる）、トピックの ARN を書いた SSM パラメータを置く。各アプリのリポは SSM から ARN を読んでアラームを向ける。Lambda レイヤーの仕組みはコンストラクトだけ作り、本番のスタックにはまだ置かない。

**Tech Stack:** aws-cdk-lib 2.x / constructs 10.x / @mrgrain/cdk-esbuild 5.x / esbuild / tsx / Vitest / dotenv / Node.js 24（`lambda.Runtime.NODEJS_24_X`・arm64）

**Spec:** `docs/superpowers/specs/2026-11-10-m19-monitoring-design.md`

## Global Constraints

- `package.json` は `"type": "module"`。相対 import には `.js` を付ける。
- stage は `cdk ... -c STAGE=<stage>` で選び、`bin/` の入口だけが dotenv で `.env.<stage>` を読む。スタック・コンストラクトは `process.env` を読まない。
- `STAGE` が無い・`prod` 以外なら synth の時点で `Error` を投げて落とす（今は `prod` だけ）。
- 名前の前置きは `sotetsu-lab-v3-prod-monitoring`（ほかのリポの `${system}-${stage}-${role}` にそろえる）。スタック名は `sotetsu-lab-v3-prod-monitoring-cfstack`。
- SSM パラメータ名（ほかのリポの平らな名前にそろえる）:
  - トピックの ARN（CDK が作る String）：`sotetsu-lab-v3-monitoring-alarm-topic-arn`
  - Webhook URL（ユーザーが手で作る SecureString）：`sotetsu-lab-v3-monitoring-discord-webhook-url`
- Webhook URL をコード・テンプレート・`.env` に書かない。
- `.env.*` は git に入れない（`.env.example` だけ入れる）。
- コミットは Conventional Commits＋絵文字（例 `feat: :sparkles: …`）、日本語。末尾に次の 2 行を付ける。
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NxksuqCpWLTXCFvmXt2nKt
  ```
- コミットの GPG 署名はサンドボックスの外で通る（通らなければ `dangerouslyDisableSandbox`）。

## Review Focus

- SNS に CloudWatch の JSON でない文（手で `aws sns publish` したテスト）が来る → 落ちずに、その文をそのまま Discord に出す。Task 2 のテスト `JSON でない Message はそのまま本文にする` で押さえる。
- `NewStateValue` が `INSUFFICIENT_DATA` で来る（アラームの作り直しのときなど）→ 送らない。どうでもいい知らせを混ぜない。Task 2 のテスト `INSUFFICIENT_DATA は null を返す` で押さえる。
- Discord が 429・5xx を返す → Lambda をエラーで終わらせ、SNS の再送に任せる（握りつぶさない）。Task 3 のテスト `Discord が 2xx 以外ならエラーで終わる` で押さえる。
- `NewStateReason` がとても長い → Discord の Embed の上限（description 4096 字・field の value 1024 字）で弾かれない。Task 2 のテスト `理由は 1024 字に切る` で押さえる。
- `-c STAGE` を付け忘れた `cdk deploy` → 何も作らずに落ちる。Task 1 のテスト `STAGE が無ければ投げる` で押さえる。

---

### Task 1: 土台（CDK アプリ・stage の設定・テストの道具）

**Files:**
- Create: `package.json`, `tsconfig.json`, `cdk.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `bin/monitoring.ts`, `lib/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces:
  - `type Stage = 'prod'`
  - `interface MonitoringConfig { stage: Stage; prefix: string; account: string; region: string; webhookUrlParameterName: string; alarmTopicArnParameterName: string }`
  - `function loadConfig(stage: string | undefined, env: Record<string, string | undefined>): MonitoringConfig`（`lib/config.ts`）

- [ ] **Step 1: 土台のファイルを作る**
  - `cdk init app --language typescript` の構成を手で起こす（`cdk init` は空でないディレクトリで動かないため）。`bin/`・`lib/`・`test/`。
  - 依存: `aws-cdk-lib`・`constructs`・`@mrgrain/cdk-esbuild`・`dotenv`。devDependencies: `aws-cdk`（CLI）・`typescript`・`tsx`・`vitest`・`esbuild`・`@types/node`・`@types/aws-lambda`。版は入れた時点の最新。Node の版はほかのリポにそろえて `mise.toml` を置く。
  - `cdk.json` の `app` は `npx tsx bin/monitoring.ts`。
  - `.gitignore` に `node_modules`・`cdk.out`・`.env`・`.env.*`・`!.env.example`。
  - `.env.example` の鍵: `ACCOUNT_ID`・`REGION`。`.env.prod` は手元で `ACCOUNT_ID=442730633672`・`REGION=ap-northeast-1` を入れて作る（git に入れない）。
  - `package.json` の scripts: `test`（`vitest run`）・`synth:prod`（`cdk synth -c STAGE=prod`）・`diff:prod`・`deploy:prod`。

- [ ] **Step 2: 落ちるテストを書く**（`test/config.test.ts`）
  - `STAGE が無ければ投げる`: `loadConfig(undefined, {...})` が `/STAGE/` を含む Error を投げる。
  - `知らない STAGE は投げる`: `loadConfig('dev', {...})` が投げる。
  - `ACCOUNT_ID が無ければ投げる`。
  - `prod の設定を組む`: `loadConfig('prod', { ACCOUNT_ID: '442730633672', REGION: 'ap-northeast-1' })` が `{ stage: 'prod', prefix: 'sotetsu-lab-v3-prod-monitoring', account: '442730633672', region: 'ap-northeast-1', webhookUrlParameterName: 'sotetsu-lab-v3-monitoring-discord-webhook-url', alarmTopicArnParameterName: 'sotetsu-lab-v3-monitoring-alarm-topic-arn' }` と等しい。

- [ ] **Step 3: 落ちることを確かめる** — `npx vitest run test/config.test.ts` → FAIL（`loadConfig` が無い）

- [ ] **Step 4: `loadConfig` を書く。** `bin/monitoring.ts` は `app.node.tryGetContext('STAGE')` を読み、`dotenv.config({ path: \`.env.${stage}\` })` のあと `loadConfig(stage, process.env)` を呼ぶ（スタックは Task 4 で足す）。

- [ ] **Step 5: 通ることを確かめる** — `npx vitest run` → PASS。`npx cdk synth` → STAGE の Error で落ちる。

- [ ] **Step 6: コミット** — `build: :tada: CDK の土台と stage の設定を作る`

### Task 2: アラームを Discord の文面にする

**Files:**
- Create: `src/functions/discord-notifier/format.ts`
- Test: `test/functions/discord-notifier/format.test.ts`

**Interfaces:**
- Produces:
  - `interface DiscordPayload { content?: string; embeds?: DiscordEmbed[] }`、`interface DiscordEmbed { title: string; description?: string; color: number; fields: { name: string; value: string }[]; url?: string; timestamp?: string }`
  - `function toDiscordPayload(snsMessage: string): DiscordPayload | null`

- [ ] **Step 1: 落ちるテストを書く**。値は CloudWatch アラームの SNS の JSON（`AlarmName`・`AlarmDescription`・`NewStateValue`・`NewStateReason`・`StateChangeTime`・`Region`）の実物の形で作る。
  - `ALARM は赤の Embed で「障害発生」と出す`（2026-11-10 にユーザー判断で文面を変更）: `NewStateValue: 'ALARM'`、`AlarmName: 'sotetsu-lab-v3-prod-api-url5xx'` → `embeds[0].title === '🔴 障害発生'`、`color === 0xe74c3c`、`description === AlarmDescription`。
  - `OK は緑の Embed で「復旧」と出す`: `title === '🟢 復旧'`、`color === 0x2ecc71`、`description` は同じ。
  - `アラーム名をフィールドに出す`: `fields` に `{ name: 'アラーム', value: AlarmName }`。順は アラーム・理由・時刻。
  - `AlarmDescription が無い・空ならアラーム名を説明にする`。
  - `時刻は JST で出す`: `StateChangeTime: '2026-10-14T08:00:00.000+0000'` → `fields` に `{ name: '時刻', value: '2026-10-14 17:00' }`。
  - `理由を出す`: `fields` に `{ name: '理由', value: NewStateReason }`。
  - `理由は 1024 字に切る`: 2000 字の理由 → value の長さが 1024 以下。
  - `コンソールの URL を付ける`: `url === 'https://ap-northeast-1.console.aws.amazon.com/cloudwatch/home?region=ap-northeast-1#alarmsV2:alarm/sotetsu-lab-v3-prod-api-url5xx'`（名前は `encodeURIComponent`）。
  - `INSUFFICIENT_DATA は null を返す`。
  - `JSON でない Message はそのまま本文にする`: `'テスト'` → `{ content: 'テスト' }`。

- [ ] **Step 2: 落ちることを確かめる** — `npx vitest run test/functions/discord-notifier` → FAIL

- [ ] **Step 3: `toDiscordPayload` を書く。** 副作用なし。JST は `Intl.DateTimeFormat`（`timeZone: 'Asia/Tokyo'`）で組む。

- [ ] **Step 4: 通ることを確かめる** — PASS

- [ ] **Step 5: コミット** — `feat: :sparkles: アラームを Discord の文面にする`

### Task 3: Discord に送るハンドラ

**Files:**
- Create: `src/functions/discord-notifier/handler.ts`
- Test: `test/functions/discord-notifier/handler.test.ts`

**Interfaces:**
- Consumes: `toDiscordPayload`（Task 2）
- Produces:
  - `function createHandler(deps: { getWebhookUrl: () => Promise<string>; post: typeof fetch }): (event: SNSEvent) => Promise<void>`
  - `export const handler`（本番用。`getWebhookUrl` は `@aws-sdk/client-ssm` の `GetParameterCommand`（`WithDecryption: true`）で、名前は環境変数 `WEBHOOK_URL_PARAMETER_NAME`。最初の 1 回だけ読んで、モジュールの変数に持つ。`post` は標準の `fetch`）

- [ ] **Step 1: 落ちるテストを書く**（`getWebhookUrl`・`post` は偽物を渡す）
  - `レコードごとに Webhook に POST する`: 2 レコード → `post` が 2 回、`method: 'POST'`、`content-type: application/json`、本文は `toDiscordPayload` の結果。
  - `null の文面は送らない`: INSUFFICIENT_DATA のレコード → `post` が呼ばれない。
  - `Discord が 2xx 以外ならエラーで終わる`: `post` が `new Response('', { status: 429 })` → `rejects.toThrow(/429/)`。
  - `Webhook URL は 1 回だけ読む`: 同じハンドラを 2 回呼ぶ → `getWebhookUrl` は 1 回。

- [ ] **Step 2: 落ちることを確かめる** — FAIL

- [ ] **Step 3: `createHandler` と `handler` を書く。**

- [ ] **Step 4: 通ることを確かめる** — PASS

- [ ] **Step 5: コミット** — `feat: :sparkles: アラームを Discord に送る Lambda を書く`

### Task 4: スタック（SNS・転送 Lambda・SSM）

**Files:**
- Create: `lib/monitoring-stack.ts`
- Modify: `bin/monitoring.ts`（スタックを作る）
- Test: `test/monitoring-stack.test.ts`

**Interfaces:**
- Consumes: `MonitoringConfig`（Task 1）、`src/functions/discord-notifier/handler.ts` の `handler`（Task 3）
- Produces: `class MonitoringStack extends Stack { constructor(scope: Construct, id: string, props: StackProps & { config: MonitoringConfig }) }`、公開プロパティ `readonly alarmTopic: sns.Topic`

- [ ] **Step 1: 落ちるテストを書く**（`aws-cdk-lib/assertions` の `Template`。`loadConfig('prod', …)` で組んだ設定を使う）
  - `トピックを 1 つ作る`: `AWS::SNS::Topic` が 1 つ、`TopicName: 'sotetsu-lab-v3-prod-monitoring-alarm-topic'`。
  - `転送 Lambda を作る`: `AWS::Lambda::Function` に `FunctionName: 'sotetsu-lab-v3-prod-monitoring-discord-notifier-lambda'`、`Runtime: 'nodejs24.x'`、`Architectures: ['arm64']`、`Environment.Variables.WEBHOOK_URL_PARAMETER_NAME: 'sotetsu-lab-v3-monitoring-discord-webhook-url'`。
  - `トピックを Lambda が購読する`: `AWS::SNS::Subscription` の `Protocol: 'lambda'`。
  - `Lambda は Webhook のパラメータだけを読める`: IAM ポリシーに `ssm:GetParameter` があり、Resource が `…:parameter/sotetsu-lab-v3-monitoring-discord-webhook-url`。
  - `ARN を SSM に書く`: `AWS::SSM::Parameter` に `Name: 'sotetsu-lab-v3-monitoring-alarm-topic-arn'`、`Type: 'String'`、`Value` がトピックの `Ref`。
  - `ログは 30 日`: ロググループの `RetentionInDays: 30`（ほかのリポの `logRetentionInDays: 30` にそろえる）。

- [ ] **Step 2: 落ちることを確かめる** — FAIL

- [ ] **Step 3: `MonitoringStack` を書く。**
  - Lambda は `lambda.Function` に `code: new TypeScriptCode('src/functions/discord-notifier/handler.ts', { buildOptions: { format: 'esm', platform: 'node', target: 'node24', external: ['@aws-sdk/*'], outExtension: { '.js': '.mjs' } } })`、`handler: 'index.handler'`。束ねた出力のファイル名と `handler` が合っているかは Step 4 で確かめる。
  - タイムアウト 10 秒・メモリ 128MB（私の判断・送るだけ）。
  - KMS の既定鍵で暗号化された SecureString の復号は `ssm:GetParameter` で足りる（AWS 管理鍵のとき）。足りなければ `kms:Decrypt` を足す。
  - `bin/monitoring.ts` で `new MonitoringStack(app, 'sotetsu-lab-v3-prod-monitoring-cfstack', { stackName: …, env: { account, region }, config })`。タグは `System: sotetsu-lab-v3`・`Stage: prod`・`Role: monitoring`（socket の stackTags にそろえる）。

- [ ] **Step 4: 通ることを確かめる** — `npx vitest run` → PASS。`npm run synth:prod` が通り、`cdk.out` の Lambda のアセットに `index.mjs` があり、中に `@aws-sdk` の本体が束ねられていない（`grep -c "client-ssm" <アセット>/index.mjs` が import 文の分だけ）。

- [ ] **Step 5: コミット** — `feat: :sparkles: SNS と Discord 転送のスタックを作る`

### Task 5: Lambda レイヤーの仕組み

**Files:**
- Create: `lib/layers/dependencies-layer.ts`, `lib/layers/local-bundler.ts`, `lib/layers/bundle.sh`（実行権限つき）, `src/functions/package.json`（`dependencies: {}`）, `src/functions/package-lock.json`
- Test: `test/layers/dependencies-layer.test.ts`, `test/layers/bundle.test.ts`, `test/layers/fixture/package.json`・`package-lock.json`（依存 1 つ。小さく依存の無いもの。例 `ms`）

**Interfaces:**
**土台:** ユーザーが以前の CDK で書いた `LocalBundler`・`bundle.sh`・`#buildLayer()`（2026-11-10 にチャットで共有。下の Interfaces に写した）。直すのは 4 つ（2026-11-10 ユーザー承認）。
1. 材料をリポの根っこでなく `src/functions/` にする。根っこの `dependencies`（`aws-cdk-lib` など）がレイヤーに入らないように。ハッシュも、Lambda のコードや docs を直しただけで変わらないように。
2. `compatibleArchitectures` は `ARM_64` だけにする。手元の組み立ては arm64 向けに入れる（`npm ci` に `--cpu=arm64 --os=linux`）。Docker 側は `platform: 'linux/arm64'`。
3. `bundle.sh` の先頭に `#!/usr/bin/env bash` と `set -euo pipefail`。途中の失敗で欠けたレイヤーを成功扱いにしない。
4. ランタイムは `NODEJS_24_X`。

**Interfaces:**
- Produces:
  - `class DependenciesLayer extends Construct { readonly layer: lambda.LayerVersion; readonly externals: string[]; constructor(scope: Construct, id: string, props: { sourceDir: string; layerVersionName: string }) }`
    - `externals` は `sourceDir/package.json` の `dependencies` のキー。依存を持つ Lambda は `buildOptions.external` に `[...layer.externals, '@aws-sdk/*']` を渡し、`layers: [layer.layer]` を付ける。
    - `LayerVersion` の中身はユーザーの `#buildLayer()` と同じ形。`compatibleRuntimes: [Runtime.NODEJS_24_X]`・`compatibleArchitectures: [Architecture.ARM_64]`・`removalPolicy: RemovalPolicy.DESTROY`・`code: Code.fromAsset(sourceDir, { exclude: ['.*', 'node_modules'], bundling: { local: new LocalBundler(sourceDir), image: Runtime.NODEJS_24_X.bundlingImage, platform: 'linux/arm64', user: 'root', command: ['bash', '-c', 'mkdir -p /asset-output/nodejs && cp package.json package-lock.json /asset-output/nodejs/ && npm ci --omit=dev --prefix /asset-output/nodejs'] } })`。
  - `class LocalBundler implements ILocalBundling { constructor(private readonly rootDir: string) }` — ユーザーのコードのまま（`execFileSync(resolve(import.meta.dirname, 'bundle.sh'), { env: { ...process.env, BUNDLER_OUTPUT_DIR, BUNDLER_ROOT_DIR }, timeout: 60 秒, encoding: 'utf-8' })`、失敗したら `console.error` して `false`）。
  - `bundle.sh` — ユーザーのスクリプト（`BUNDLER_OUTPUT_DIR`・`BUNDLER_ROOT_DIR` の確かめ → `<出力>/nodejs` を作る → `cd` → `cp package.json package-lock.json` → `npm ci --omit=dev --prefix`）に、直し 2・3 を足す。

- [ ] **Step 1: npm の `--cpu`・`--os` が `npm ci` で効くかを確かめる。** 手元の npm は 11.19.0。npm の公式文書（config の `cpu`・`os`）で確かめる。効かなければ、手元の組み立てをやめて常に Docker（`tryBundle` が `false` を返す）にする案に切り替え、ユーザーに伝える。

- [ ] **Step 2: 落ちるテストを書く**
  - `bundle.sh が nodejs/node_modules を作る`: 一時ディレクトリを出力にして fixture で流す → `nodejs/node_modules/ms/package.json` がある。
  - `bundle.sh は cp の失敗で止まる`: `package-lock.json` の無いディレクトリを `BUNDLER_ROOT_DIR` にする → 終了コードが 0 でない。
  - `bundle.sh は BUNDLER_OUTPUT_DIR が無ければ止まる`: 終了コードが 0 でない。
  - `レイヤーをテンプレートに出す`: 空のスタックに fixture の `DependenciesLayer` を置く → `AWS::Lambda::LayerVersion` が 1 つ、`CompatibleRuntimes: ['nodejs24.x']`、`CompatibleArchitectures: ['arm64']`。
  - `externals は dependencies のキー`: fixture → `['ms']`。

- [ ] **Step 3: 落ちることを確かめる** — FAIL

- [ ] **Step 4: 3 つを書く。**

- [ ] **Step 5: 通ることを確かめる** — PASS。`npm run synth:prod` のテンプレートに `AWS::Lambda::LayerVersion` が**無い**（本番のスタックにはまだ置かない）。

- [ ] **Step 6: ESM から import できるかを実物で確かめる。** 使い捨てのスタック（`test/layers/esm-probe/`・本番のスタックとは別名）に、fixture のレイヤーと、`import ms from 'ms'` して結果を返すだけの ESM の Lambda（`external: ['ms']`）を置いてデプロイし、`aws lambda invoke` で呼ぶ。
  - 通れば、README に「素の名前で import できる」と書く。
  - `ERR_MODULE_NOT_FOUND` なら、回避策（`/opt/nodejs/node_modules` から読む仕掛け。api の `register-node-path.js` を参考にする）を仕組みに足すかをユーザーに聞く。
  - どちらの場合も、確かめたら使い捨てのスタックは `cdk destroy` で消す。
  - AWS への操作なので、Task 6 の MFA のあとで流してよい（順番を Task 6 の Step 5 の後ろに回す）。

- [ ] **Step 5: コミット** — `feat: :sparkles: Lambda レイヤーを作る仕組みを足す`

### Task 6: README・ADR・デプロイと実地の確かめ

**Files:**
- Create: `README.md`, `docs/adr/0001-monitoring-with-cdk.md`

- [ ] **Step 1: README を書く。** 中身：何のリポか（M19）、`.env.prod` の作り方、`npm run deploy:prod` の流し方（`aws-vault exec administrator -- …`）、初回の `cdk bootstrap aws://442730633672/ap-northeast-1`、Webhook URL の入れ方（`aws ssm put-parameter --name sotetsu-lab-v3-monitoring-discord-webhook-url --type SecureString --value <URL>`・Discord の「チャンネルの編集 → 連携サービス → ウェブフック」）、テストの送り方（`aws sns publish --topic-arn <ARN> --message テスト` と `aws cloudwatch set-alarm-state --alarm-name <名前> --state-value ALARM --state-reason テスト`）、レイヤーの使い方（Task 5 の Interfaces）と、ESM の Lambda がレイヤーの依存を素の名前で import できるかは初めて使うときに確かめること。

- [ ] **Step 2: ADR を書く。** 「Terraform でなく CDK にした理由」（infrastructure の Terraform は 2026-06-11 に凍結、ユーザーが TypeScript の CDK を選んだ）、「アラームはアプリの各リポに置く理由」（関数の定義の隣で直し忘れない）、「stage は context＋dotenv」（GitHub の environment ごとに値とデプロイの決まりを分けられる。CDK 公式の推しと違う理由）、「SSM でつなぎ Export/ImportValue にしない理由」。

- [ ] **Step 3: コミット** — `docs: :memo: README と ADR-0001 を書く`

- [ ] **Step 4: ユーザーに頼む**（ここで止まって待つ）: ① Discord で Webhook を作り、`aws ssm put-parameter` で入れる ② aws-vault の MFA（`! aws-vault exec administrator --mfa-token=NNNNNN -- aws sts get-caller-identity`）。

- [ ] **Step 5: bootstrap とデプロイ** — `aws-vault exec administrator -- npx cdk bootstrap …` → `aws-vault exec administrator -- npm run deploy:prod`。Expected: スタックが `CREATE_COMPLETE`、`aws ssm get-parameter --name sotetsu-lab-v3-monitoring-alarm-topic-arn` が ARN を返す。

- [ ] **Step 6: 実地で確かめる** — `aws sns publish --message テスト` → Discord に「テスト」が届く。届かなければ転送 Lambda のログを見る。

- [ ] **Step 7: GitHub にリポを作るかをユーザーに聞く**（公開・非公開と置き場所はユーザーが決める。勝手に作らない）。
