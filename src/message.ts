// ประกอบข้อความแจ้งเตือนแบบ Components V2 (การ์ดมีแบนเนอร์ + ปุ่ม)
import { formatDays, type AdRow } from './schedule';

export const IS_COMPONENTS_V2 = 1 << 15;
export const EPHEMERAL = 1 << 6;

// ชนิด component ของ Discord
const ACTION_ROW = 1;
const BUTTON = 2;
const TEXT = 10;
const MEDIA_GALLERY = 12;
const SEPARATOR = 14;
const CONTAINER = 17;
const LINK_STYLE = 5;

export interface BotSettings {
  donate_url?: string;
  contact_url?: string;
  accent_color?: string; // "#e91e63"
}

export interface ReminderView {
  title: string;
  message: string | null;
  days: number;
  mention: string | null;
  created_by: string;
}

export interface Slot {
  hm: string;
  round: number;
  total: number;
}

const DEFAULT_ACCENT = 0xe91e63;

function accent(s: BotSettings): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(s.accent_color ?? '');
  return m ? parseInt(m[1], 16) : DEFAULT_ACCENT;
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function isHttpUrl(u: string | null | undefined): u is string {
  return !!u && /^https?:\/\/\S+$/i.test(u);
}

function linkButton(label: string, url: string, emoji?: string) {
  return { type: BUTTON, style: LINK_STYLE, label, url, ...(emoji ? { emoji: { name: emoji } } : {}) };
}

export function buildReminderMessage(r: ReminderView, slot: Slot, ad: AdRow | null, settings: BotSettings) {
  const inner: unknown[] = [];

  if (ad && isHttpUrl(ad.image_url)) {
    inner.push({ type: MEDIA_GALLERY, items: [{ media: { url: ad.image_url }, description: ad.label ?? undefined }] });
  }

  inner.push({ type: TEXT, content: `### 🔔 ${clip(r.title, 100)}` });

  if (r.message?.trim()) {
    // กล่องข้อความแบบในตัวอย่าง — กัน ``` ในข้อความไม่ให้ปิดกล่องก่อน
    inner.push({ type: TEXT, content: '```\n' + clip(r.message.replace(/```/g, "'''"), 1500) + '\n```' });
  }

  const roundText = slot.total > 1 ? `รอบ ${slot.round}/${slot.total} ของวันนี้ · ` : '';
  inner.push({
    type: TEXT,
    content: [
      `⏰ **เวลา:** ${roundText}\`${slot.hm}\``,
      `📅 **ซ้ำ:** ${formatDays(r.days)}`,
      `👤 **ตั้งโดย:** <@${r.created_by}>`,
    ].join('\n'),
  });

  const buttons = [];
  if (isHttpUrl(settings.donate_url)) buttons.push(linkButton('Donate', settings.donate_url, '💖'));
  if (isHttpUrl(settings.contact_url)) buttons.push(linkButton('ติดต่อ', settings.contact_url, '📩'));
  if (buttons.length) {
    inner.push({ type: SEPARATOR, divider: true, spacing: 1 });
    inner.push({ type: ACTION_ROW, components: buttons });
  }

  if (ad) {
    inner.push({ type: SEPARATOR, divider: true, spacing: 1 });
    inner.push({ type: TEXT, content: `-# โฆษณา${ad.label ? ` · ${clip(ad.label, 80)}` : ''}` });
    if (isHttpUrl(ad.link_url)) {
      inner.push({ type: ACTION_ROW, components: [linkButton(clip(ad.label || 'ดูเพิ่มเติม', 80), ad.link_url, '✨')] });
    }
  }

  const components: unknown[] = [];
  // ข้อความ V2 ใส่ content ไม่ได้ — @ คนไว้เหนือการ์ด ให้แจ้งเตือนเด้งจริง
  if (r.mention) components.push({ type: TEXT, content: r.mention });
  components.push({ type: CONTAINER, accent_color: accent(settings), components: inner });

  return {
    flags: IS_COMPONENTS_V2,
    components,
    allowed_mentions: allowedMentions(r.mention),
  };
}

/** เด้งเฉพาะคน/role ที่ตั้งให้ @ — "ตั้งโดย <@…>" ในการ์ดไม่เด้ง */
export function allowedMentions(mention: string | null) {
  if (!mention) return { parse: [] };
  if (mention === '@everyone' || mention === '@here') return { parse: ['everyone'] };
  const role = /^<@&(\d+)>$/.exec(mention);
  if (role) return { parse: [], roles: [role[1]] };
  const user = /^<@!?(\d+)>$/.exec(mention);
  if (user) return { parse: [], users: [user[1]] };
  return { parse: [] };
}
