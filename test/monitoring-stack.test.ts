import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../lib/config.js';
import { MonitoringStack } from '../lib/monitoring-stack.js';

describe('MonitoringStack', () => {
  let template: Template;

  beforeAll(() => {
    const config = loadConfig('prod', { ACCOUNT_ID: '442730633672', REGION: 'ap-northeast-1' });
    const app = new App();
    const stack = new MonitoringStack(app, 'TestStack', {
      env: { account: config.account, region: config.region },
      config,
    });
    template = Template.fromStack(stack);
  });

  it('トピックを 1 つ作る', () => {
    template.resourceCountIs('AWS::SNS::Topic', 1);
    template.hasResourceProperties('AWS::SNS::Topic', {
      TopicName: 'sotetsu-lab-v3-prod-monitoring-alarm-topic',
    });
  });

  it('転送 Lambda を作る', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'sotetsu-lab-v3-prod-monitoring-discord-notifier-lambda',
      Runtime: 'nodejs24.x',
      Architectures: ['arm64'],
      MemorySize: 256,
      Environment: {
        Variables: {
          WEBHOOK_URL_PARAMETER_NAME: 'sotetsu-lab-v3-prod-monitoring-discord-webhook-url',
        },
      },
    });
  });

  it('SDK を渡すレイヤーを 1 つ作り、転送 Lambda が使う', () => {
    template.resourceCountIs('AWS::Lambda::LayerVersion', 1);
    template.hasResourceProperties('AWS::Lambda::LayerVersion', {
      LayerName: 'sotetsu-lab-v3-prod-monitoring-dependencies-layer',
      CompatibleRuntimes: ['nodejs24.x'],
      CompatibleArchitectures: ['arm64'],
    });
    const layers = template.findResources('AWS::Lambda::LayerVersion');
    const [layerId] = Object.keys(layers);
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'sotetsu-lab-v3-prod-monitoring-discord-notifier-lambda',
      Layers: [{ Ref: layerId }],
    });
  });

  it('トピックを Lambda が購読する', () => {
    template.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'lambda' });
  });

  it('Lambda は Webhook のパラメータだけを読める', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ssm:GetParameter',
            Resource: Match.objectLike({
              'Fn::Join': [
                '',
                Match.arrayWith([
                  ':ssm:ap-northeast-1:442730633672:parameter/sotetsu-lab-v3-prod-monitoring-discord-webhook-url',
                ]),
              ],
            }),
          }),
        ]),
      },
    });
  });

  it('ARN を SSM に書く', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: 'sotetsu-lab-v3-prod-monitoring-alarm-topic-arn',
      Type: 'String',
      Value: { Ref: Match.stringLikeRegexp('^AlarmTopic') },
    });
  });

  it('ログは 30 日', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/aws/lambda/sotetsu-lab-v3-prod-monitoring-discord-notifier-lambda',
      RetentionInDays: 30,
    });
    expect(template.findResources('AWS::Logs::LogGroup')).not.toEqual({});
  });

  it('ロググループは消すときに残さない', () => {
    template.hasResource('AWS::Logs::LogGroup', {
      DeletionPolicy: 'Delete',
      UpdateReplacePolicy: 'Delete',
    });
  });
});
