import { describe, expect, it } from 'vitest';
import { loadConfig } from '../lib/config.js';

const env = { ACCOUNT_ID: '442730633672', REGION: 'ap-northeast-1' };

describe('loadConfig', () => {
  it('STAGE が無ければ投げる', () => {
    expect(() => loadConfig(undefined, env)).toThrow(/STAGE/);
  });

  it('知らない STAGE は投げる', () => {
    expect(() => loadConfig('dev', env)).toThrow();
  });

  it('ACCOUNT_ID が無ければ投げる', () => {
    expect(() => loadConfig('prod', { REGION: 'ap-northeast-1' })).toThrow(/ACCOUNT_ID/);
  });

  it('prod の設定を組む', () => {
    expect(loadConfig('prod', env)).toEqual({
      stage: 'prod',
      account: '442730633672',
      region: 'ap-northeast-1',
      resourceNames: {
        stack: 'sotetsu-lab-v3-prod-monitoring-cfn-stack',
        alarmTopic: 'sotetsu-lab-v3-prod-monitoring-alarm-topic',
        discordNotifierFunction: 'sotetsu-lab-v3-prod-monitoring-discord-notifier-lambda',
        discordNotifierLogGroup: '/aws/lambda/sotetsu-lab-v3-prod-monitoring-discord-notifier-lambda',
        dependenciesLayer: 'sotetsu-lab-v3-prod-monitoring-dependencies-layer',
        webhookUrlParameter: 'sotetsu-lab-v3-prod-monitoring-discord-webhook-url',
        alarmTopicArnParameter: 'sotetsu-lab-v3-prod-monitoring-alarm-topic-arn',
      },
    });
  });
});
