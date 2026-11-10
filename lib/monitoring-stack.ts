import { Duration, RemovalPolicy, Stack, StackProps, Tags } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { TypeScriptCode } from '@mrgrain/cdk-esbuild';
import { Construct } from 'constructs';
import type { MonitoringConfig } from './config.js';

export interface MonitoringStackProps extends StackProps {
  config: MonitoringConfig;
}

export class MonitoringStack extends Stack {
  readonly alarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);
    const { config } = props;
    const names = config.resourceNames;

    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: names.alarmTopic,
    });

    const logGroup = new logs.LogGroup(this, 'DiscordNotifierLogGroup', {
      logGroupName: names.discordNotifierLogGroup,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const notifier = new lambda.Function(this, 'DiscordNotifier', {
      functionName: names.discordNotifierFunction,
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: new TypeScriptCode('src/functions/discord-notifier/handler.ts', {
        buildOptions: {
          format: 'esm',
          platform: 'node',
          target: 'node24',
          outfile: 'index.mjs',
          // 束ねた SDK 配下の CJS が実行時に require する（node:http など）ため、ESM に require を用意する
          banner: {
            js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
          },
        },
      }),
      timeout: Duration.seconds(10),
      memorySize: 128,
      logGroup,
      environment: {
        WEBHOOK_URL_PARAMETER_NAME: names.webhookUrlParameter,
      },
    });

    notifier.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          this.formatArn({
            service: 'ssm',
            resource: 'parameter',
            resourceName: names.webhookUrlParameter,
          }),
        ],
      }),
    );

    this.alarmTopic.addSubscription(new subscriptions.LambdaSubscription(notifier));

    new ssm.StringParameter(this, 'AlarmTopicArnParameter', {
      parameterName: names.alarmTopicArnParameter,
      stringValue: this.alarmTopic.topicArn,
    });

    Tags.of(this).add('System', 'sotetsu-lab-v3');
    Tags.of(this).add('Stage', config.stage);
    Tags.of(this).add('Role', 'monitoring');
  }
}
