import type { SNSEvent } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { createHandler } from '../../../src/functions/discord-notifier/handler.js';
import { toDiscordPayload } from '../../../src/functions/discord-notifier/format.js';

function body(state: string): string {
  return JSON.stringify({
    AlarmName: 'sotetsu-lab-v3-prod-api-url5xx',
    AlarmDescription: 'API の 5xx が出ている',
    NewStateValue: state,
    NewStateReason: 'Threshold Crossed',
    StateChangeTime: '2026-10-14T08:00:00.000+0000',
    Region: 'Asia Pacific (Tokyo)',
  });
}

function event(...states: string[]): SNSEvent {
  return {
    Records: states.map((s, i) => ({
      Sns: { Message: body(s), MessageId: `id-${i}` },
    })),
  } as unknown as SNSEvent;
}

function setup(res: () => Response = () => new Response(null, { status: 204 })) {
  const getWebhookUrl = vi.fn(async () => 'https://discord.example/webhook');
  const post = vi.fn(async () => res());
  const handler = createHandler({ getWebhookUrl, post: post as unknown as typeof fetch });
  return { getWebhookUrl, post, handler };
}

describe('createHandler', () => {
  it('レコードごとに Webhook に POST する', async () => {
    const { post, handler } = setup();
    await handler(event('ALARM', 'OK'));
    expect(post).toHaveBeenCalledTimes(2);
    const [url, init] = post.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://discord.example/webhook');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify(toDiscordPayload(body('ALARM'))));
  });

  it('null の文面は送らない', async () => {
    const { post, handler } = setup();
    await handler(event('INSUFFICIENT_DATA'));
    expect(post).not.toHaveBeenCalled();
  });

  it('Discord が 2xx 以外ならエラーで終わる', async () => {
    const { handler } = setup(() => new Response('', { status: 429 }));
    await expect(handler(event('ALARM'))).rejects.toThrow(/429/);
  });

  it('Webhook URL は 1 回だけ読む', async () => {
    const { getWebhookUrl, handler } = setup();
    await handler(event('ALARM'));
    await handler(event('OK'));
    expect(getWebhookUrl).toHaveBeenCalledTimes(1);
  });

  it('401・404 のときは次の実行で Webhook URL を読み直す', async () => {
    const statuses = [404, 204];
    const { getWebhookUrl, handler } = setup(() => {
      const status = statuses.shift() ?? 204;
      return status === 204 ? new Response(null, { status }) : new Response('Unknown Webhook', { status });
    });
    await expect(handler(event('ALARM'))).rejects.toThrow(/404/);
    await handler(event('ALARM'));
    expect(getWebhookUrl).toHaveBeenCalledTimes(2);
  });

  it('失敗時のログに本文を出し、URL は出さない', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { handler } = setup(() => new Response('x'.repeat(800), { status: 429 }));
    const rejected = handler(event('ALARM'));
    await expect(rejected).rejects.toThrow(/429/);
    await rejected.catch((e: Error) => expect(e.message).not.toContain('discord.example'));
    const logged = err.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('429');
    expect(logged).toContain('x'.repeat(500));
    expect(logged).not.toContain('x'.repeat(501));
    expect(logged).not.toContain('discord.example');
    err.mockRestore();
  });
});
