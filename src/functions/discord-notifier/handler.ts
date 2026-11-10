import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import type { SNSEvent } from 'aws-lambda';
import { toDiscordPayload } from './format.js';

export interface HandlerDeps {
  getWebhookUrl: () => Promise<string>;
  post: typeof fetch;
}

export function createHandler(deps: HandlerDeps): (event: SNSEvent) => Promise<void> {
  let webhookUrl: string | undefined;

  return async (event) => {
    for (const record of event.Records) {
      const payload = toDiscordPayload(record.Sns.Message);
      if (payload === null) {
        console.log(`MessageId=${record.Sns.MessageId} 送らない`);
        continue;
      }
      webhookUrl ??= await deps.getWebhookUrl();
      const res = await deps.post(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(`Discord への送信に失敗した: ${res.status}`);
      }
    }
  };
}

const ssm = new SSMClient({});

async function getWebhookUrlFromSsm(): Promise<string> {
  const name = process.env.WEBHOOK_URL_PARAMETER_NAME;
  if (!name) throw new Error('WEBHOOK_URL_PARAMETER_NAME が未設定');
  const out = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  const value = out.Parameter?.Value;
  if (!value) throw new Error(`SSM パラメータが空: ${name}`);
  return value;
}

export const handler = createHandler({ getWebhookUrl: getWebhookUrlFromSsm, post: fetch });
