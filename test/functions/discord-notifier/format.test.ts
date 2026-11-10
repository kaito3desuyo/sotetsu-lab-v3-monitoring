import { describe, expect, it } from 'vitest';
import { toDiscordPayload } from '../../../src/functions/discord-notifier/format.js';

const name = 'sotetsu-lab-v3-prod-api-url5xx';

function msg(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    AlarmName: name,
    AlarmDescription: 'API の 5xx が出ている',
    NewStateValue: 'ALARM',
    NewStateReason: 'Threshold Crossed: 1 datapoint [3.0] was >= 1.0',
    StateChangeTime: '2026-10-14T08:00:00.000+0000',
    Region: 'Asia Pacific (Tokyo)',
    ...over,
  });
}

describe('toDiscordPayload', () => {
  it('ALARM は赤の Embed で「障害発生」と出す', () => {
    const e = toDiscordPayload(msg())!.embeds![0];
    expect(e.title).toBe('🔴 障害発生');
    expect(e.color).toBe(0xe74c3c);
    expect(e.description).toBe('API の 5xx が出ている');
  });

  it('ALARM から OK は緑の Embed で「復旧」と出す', () => {
    const e = toDiscordPayload(msg({ OldStateValue: 'ALARM', NewStateValue: 'OK' }))!.embeds![0];
    expect(e.title).toBe('🟢 復旧');
    expect(e.color).toBe(0x2ecc71);
    expect(e.description).toBe('API の 5xx が出ている');
  });

  it('INSUFFICIENT_DATA から OK は送らない（作った直後で、障害から直ったのではない）', () => {
    expect(
      toDiscordPayload(msg({ OldStateValue: 'INSUFFICIENT_DATA', NewStateValue: 'OK' })),
    ).toBeNull();
  });

  it('INSUFFICIENT_DATA から ALARM は送る', () => {
    const e = toDiscordPayload(msg({ OldStateValue: 'INSUFFICIENT_DATA', NewStateValue: 'ALARM' }))!
      .embeds![0];
    expect(e.title).toBe('🔴 障害発生');
  });

  it('アラーム名をフィールドに出す', () => {
    const e = toDiscordPayload(msg())!.embeds![0];
    expect(e.fields).toContainEqual({ name: 'アラーム', value: name });
  });

  it('フィールドは アラーム・理由・時刻 の順', () => {
    const e = toDiscordPayload(msg())!.embeds![0];
    expect(e.fields.map((f) => f.name)).toEqual(['アラーム', '理由', '時刻']);
  });

  it('AlarmDescription が無い・空ならアラーム名を説明にする', () => {
    expect(toDiscordPayload(msg({ AlarmDescription: undefined }))!.embeds![0].description).toBe(name);
    expect(toDiscordPayload(msg({ AlarmDescription: '' }))!.embeds![0].description).toBe(name);
  });

  it('時刻は JST で出す', () => {
    const e = toDiscordPayload(msg())!.embeds![0];
    expect(e.fields).toContainEqual({ name: '時刻', value: '2026-10-14 17:00' });
  });

  it('理由を出す', () => {
    const e = toDiscordPayload(msg())!.embeds![0];
    expect(e.fields).toContainEqual({
      name: '理由',
      value: 'Threshold Crossed: 1 datapoint [3.0] was >= 1.0',
    });
  });

  it('理由は 1024 字に切る', () => {
    const e = toDiscordPayload(msg({ NewStateReason: 'あ'.repeat(2000) }))!.embeds![0];
    const reason = e.fields.find((f) => f.name === '理由')!;
    expect(reason.value.length).toBeLessThanOrEqual(1024);
  });

  it('コンソールの URL を付ける', () => {
    const e = toDiscordPayload(msg())!.embeds![0];
    expect(e.url).toBe(
      `https://ap-northeast-1.console.aws.amazon.com/cloudwatch/home?region=ap-northeast-1#alarmsV2:alarm/${encodeURIComponent(name)}`,
    );
  });

  it('INSUFFICIENT_DATA は null を返す', () => {
    expect(toDiscordPayload(msg({ NewStateValue: 'INSUFFICIENT_DATA' }))).toBeNull();
  });

  it('JSON でない Message はそのまま本文にする', () => {
    expect(toDiscordPayload('テスト')).toEqual({ content: 'テスト' });
  });
});
