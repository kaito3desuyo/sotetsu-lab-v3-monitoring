export type Stage = 'prod';

/** AWS のリソース名。名前はここだけで決め、スタックはこれを使う */
export interface ResourceNames {
  stack: string;
  alarmTopic: string;
  discordNotifierFunction: string;
  discordNotifierLogGroup: string;
  dependenciesLayer: string;
  /** Webhook URL の SecureString（手で作る。CDK は作らない） */
  webhookUrlParameter: string;
  /** トピックの ARN。各アプリの serverless.ts が `${ssm:...}` で読む */
  alarmTopicArnParameter: string;
}

export interface MonitoringConfig {
  stage: Stage;
  account: string;
  region: string;
  resourceNames: ResourceNames;
}

function resourceNames(stage: Stage): ResourceNames {
  const prefix = `sotetsu-lab-v3-${stage}-monitoring`;
  const discordNotifierFunction = `${prefix}-discord-notifier-lambda`;
  return {
    stack: `${prefix}-cfn-stack`,
    alarmTopic: `${prefix}-alarm-topic`,
    discordNotifierFunction,
    discordNotifierLogGroup: `/aws/lambda/${discordNotifierFunction}`,
    dependenciesLayer: `${prefix}-dependencies-layer`,
    webhookUrlParameter: `${prefix}-discord-webhook-url`,
    alarmTopicArnParameter: `${prefix}-alarm-topic-arn`,
  };
}

const STAGES: readonly string[] = ['prod'];

function isStage(stage: string): stage is Stage {
  return STAGES.includes(stage);
}

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`環境変数 ${key} が未設定です`);
  }
  return value;
}

export function loadConfig(
  stage: string | undefined,
  env: Record<string, string | undefined>,
): MonitoringConfig {
  if (!stage) {
    throw new Error('STAGE が未指定です。例: cdk synth -c STAGE=prod');
  }
  if (!isStage(stage)) {
    throw new Error(`知らない STAGE です: ${stage}（使えるのは ${STAGES.join(', ')}）`);
  }
  return {
    stage,
    account: required(env, 'ACCOUNT_ID'),
    region: required(env, 'REGION'),
    resourceNames: resourceNames(stage),
  };
}
