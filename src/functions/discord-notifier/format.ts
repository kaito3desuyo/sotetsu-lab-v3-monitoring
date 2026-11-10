export interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields: { name: string; value: string }[];
  url?: string;
  timestamp?: string;
}

export interface DiscordPayload {
  content?: string;
  embeds?: DiscordEmbed[];
}

const RED = 0xe74c3c;
const GREEN = 0x2ecc71;
const FIELD_LIMIT = 1024;
const DESCRIPTION_LIMIT = 4096;
const CONTENT_LIMIT = 2000;
const CONSOLE_REGION = 'ap-northeast-1';

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function formatJst(iso: string): string | null {
  // "+0000" のようなコロン無しのオフセットを "+00:00" に直す
  const date = new Date(iso.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

export function toDiscordPayload(snsMessage: string): DiscordPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(snsMessage);
  } catch {
    return { content: truncate(snsMessage, CONTENT_LIMIT) };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { content: truncate(snsMessage, CONTENT_LIMIT) };
  }

  const alarm = parsed as Record<string, unknown>;
  const state = alarm.NewStateValue;
  if (state !== 'ALARM' && state !== 'OK') return null;

  const alarmName = String(alarm.AlarmName ?? '');
  const fields: { name: string; value: string }[] = [];

  if (typeof alarm.StateChangeTime === 'string') {
    const jst = formatJst(alarm.StateChangeTime);
    if (jst) fields.push({ name: '時刻', value: jst });
  }
  if (typeof alarm.NewStateReason === 'string' && alarm.NewStateReason) {
    fields.push({ name: '理由', value: truncate(alarm.NewStateReason, FIELD_LIMIT) });
  }

  const embed: DiscordEmbed = {
    title: truncate(`${state === 'ALARM' ? '🔴 鳴った' : '🟢 直った'}: ${alarmName}`, 256),
    color: state === 'ALARM' ? RED : GREEN,
    fields,
    url: `https://${CONSOLE_REGION}.console.aws.amazon.com/cloudwatch/home?region=${CONSOLE_REGION}#alarmsV2:alarm/${encodeURIComponent(alarmName)}`,
  };
  if (typeof alarm.AlarmDescription === 'string' && alarm.AlarmDescription) {
    embed.description = truncate(alarm.AlarmDescription, DESCRIPTION_LIMIT);
  }
  return { embeds: [embed] };
}
