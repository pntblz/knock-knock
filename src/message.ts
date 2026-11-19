// ประกอบข้อความแจ้งเตือนแบบ Components V2 (การ์ดมีแบนเนอร์ + ปุ่ม)
import { formatDays, InputError, type AdRow } from './schedule';

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
  accent_color?: string; // "#9b6bd6"
}

export interface ReminderView {
  id?: number;
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

const DEFAULT_ACCENT = 0x9b6bd6; // ม่วงเข้ากับโลโก้

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

/** ●●○ แสดงว่าถึงรอบที่เท่าไรของวัน */
export function roundDots(round: number, total: number): string {
  if (total < 2 || total > 12) return '';
  return '●'.repeat(round) + '○'.repeat(Math.max(0, total - round));
}

export function buildReminderMessage(
  r: ReminderView,
  slot: Slot,
  ad: AdRow | null,
  settings: BotSettings,
  now: Date = new Date(),
) {
  const inner: unknown[] = [];

  if (ad && isHttpUrl(ad.image_url)) {
    inner.push({ type: MEDIA_GALLERY, items: [{ media: { url: ad.image_url }, description: ad.label ?? undefined }] });
  }

  inner.push({
    type: TEXT,
    content: `-# 🔔 KNOCK KNOCK · แจ้งเตือนประจำวัน\n## ${clip(r.title, 100)}`,
  });

  if (r.message?.trim()) {
    // กล่องข้อความแบบในตัวอย่าง — กัน ``` ในข้อความไม่ให้ปิดกล่องก่อน
    inner.push({ type: TEXT, content: '```\n' + clip(r.message.replace(/```/g, "'''"), 1500) + '\n```' });
  }

  const dots = roundDots(slot.round, slot.total);
  const fields = [
    `⏰ **เวลา** \`${slot.hm} น.\``,
    slot.total > 1 ? `🔁 **รอบ** \`${slot.round}/${slot.total}\` ของวันนี้ ${dots}` : null,
    `📅 **ซ้ำ** \`${formatDays(r.days)}\``,
    r.mention ? `🏷️ **แท็ก** ${r.mention}` : null,
    `👤 **ตั้งโดย** <@${r.created_by}>`,
  ].filter(Boolean);
  inner.push({ type: SEPARATOR, divider: false, spacing: 1 });
  inner.push({ type: TEXT, content: fields.join('\n') });
  // <t:…:F> = Discord แปลงเป็นวันเวลาตามภาษา/เขตเวลาของคนอ่านเอง
  inner.push({ type: TEXT, content: `-# 🗓️ <t:${Math.floor(now.getTime() / 1000)}:F>` });

  const buttons: unknown[] = [];
  const roleBtn = roleButton(r);
  if (roleBtn) buttons.push(roleBtn);
  if (isHttpUrl(settings.donate_url)) buttons.push(linkButton('Donate', settings.donate_url, '💖'));
  if (isHttpUrl(settings.contact_url)) buttons.push(linkButton('ติดต่อ', settings.contact_url, '📩'));
  buttons.push(HELP_BUTTON);
  inner.push({ type: SEPARATOR, divider: true, spacing: 1 });
  inner.push({ type: ACTION_ROW, components: buttons });

  if (ad) {
    inner.push({ type: SEPARATOR, divider: true, spacing: 1 });
    inner.push({ type: TEXT, content: `-# โฆษณา${ad.label ? ` · ${clip(ad.label, 80)}` : ''}` });
    if (isHttpUrl(ad.link_url)) {
      inner.push({ type: ACTION_ROW, components: [linkButton(clip(ad.label || 'ดูเพิ่มเติม', 80), ad.link_url, '✨')] });
    }
  }

  const components: unknown[] = [];
  // ข้อความ V2 ใส่ content ไม่ได้ — @ คนไว้เหนือการ์ด ให้แจ้งเตือนเด้งจริง
  if (r.mention) components.push({ type: TEXT, content: `${r.mention} ถึงเวลา **${clip(r.title, 100)}** แล้ว!` });
  components.push({ type: CONTAINER, accent_color: accent(settings), components: inner });

  return {
    flags: IS_COMPONENTS_V2,
    components,
    allowed_mentions: allowedMentions(r.mention),
  };
}

export const MAX_TAGS = 10;

/**
 * ดึงคน/ยศที่จะแท็กจากข้อความ เช่น "<@&123> <@456> @everyone"
 * คืนเป็นข้อความมาตรฐานคั่นด้วยช่องว่าง (ตัดซ้ำ) หรือ null ถ้าไม่มี
 */
export function normalizeTags(...inputs: (string | null | undefined)[]): string | null {
  const out: string[] = [];
  for (const input of inputs) {
    if (!input) continue;
    for (const m of input.matchAll(/<@&(\d+)>|<@!?(\d+)>|@(everyone|here)\b/g)) {
      const tag = m[1] ? `<@&${m[1]}>` : m[2] ? `<@${m[2]}>` : `@${m[3]}`;
      if (!out.includes(tag)) out.push(tag);
    }
  }
  if (out.length > MAX_TAGS) throw new InputError(`แท็กได้ไม่เกิน ${MAX_TAGS} คน/ยศ`);
  return out.length ? out.join(' ') : null;
}

/** เด้งเฉพาะคน/ยศที่ตั้งให้แท็ก — "ตั้งโดย <@…>" ในการ์ดไม่เด้ง */
export function allowedMentions(mention: string | null) {
  const roles: string[] = [];
  const users: string[] = [];
  const parse: string[] = [];
  for (const m of (mention ?? '').matchAll(/<@&(\d+)>|<@!?(\d+)>|@(everyone|here)\b/g)) {
    if (m[1]) roles.push(m[1]);
    else if (m[2]) users.push(m[2]);
    else if (!parse.includes('everyone')) parse.push('everyone');
  }
  return { parse, ...(roles.length ? { roles } : {}), ...(users.length ? { users } : {}) };
}

// ---------- ปุ่มรับ/คืนยศ ----------

export const ROLE_PREFIX = 'kk:role:';

/** ยศ (ไม่รวมคน / @everyone) ที่แจ้งเตือนนี้แท็ก */
export function tagRoleIds(mention: string | null): string[] {
  return [...(mention ?? '').matchAll(/<@&(\d+)>/g)].map((m) => m[1]);
}

/** ปุ่ม "รับแจ้งเตือน" — มีเฉพาะแจ้งเตือนที่แท็กยศ กดซ้ำ = คืนยศ */
function roleButton(r: ReminderView) {
  if (!r.id || !tagRoleIds(r.mention).length) return null;
  return { type: BUTTON, style: 1, label: 'รับ / ยกเลิกแจ้งเตือน', custom_id: `${ROLE_PREFIX}${r.id}`, emoji: { name: '🔔' } };
}

/** แผงรับยศ — ประกาศไว้ในห้องให้คนกดรับยศก่อนถึงเวลาแจ้งเตือน */
export function buildRolePanel(r: ReminderView & { times: string[] }, settings: BotSettings) {
  const roles = tagRoleIds(r.mention).map((id) => `<@&${id}>`);
  const btn = roleButton(r);
  return {
    flags: IS_COMPONENTS_V2,
    components: [
      {
        type: CONTAINER,
        accent_color: accent(settings),
        components: [
          { type: TEXT, content: `-# 🔔 KNOCK KNOCK · รับแจ้งเตือน\n## ${clip(r.title, 100)}` },
          {
            type: TEXT,
            content: [
              `กดปุ่มด้านล่างเพื่อรับยศ ${roles.join(' ')} แล้วบอทจะแท็กคุณทุกครั้งที่ถึงเวลา`,
              'กดอีกครั้งเพื่อยกเลิก',
            ].join('\n'),
          },
          { type: SEPARATOR, divider: false, spacing: 1 },
          { type: TEXT, content: `⏰ **เวลา** \`${r.times.join(' · ')}\`\n📅 **ซ้ำ** \`${formatDays(r.days)}\`` },
          ...(btn ? [{ type: ACTION_ROW, components: [btn, HELP_BUTTON] }] : []),
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

// ---------- ปุ่มและกล่อง "วิธีใช้" ----------

export const HELP_CUSTOM_ID = 'kk:help';

const HELP_BUTTON = { type: BUTTON, style: 2, label: 'คำสั่ง & วิธีใช้', custom_id: HELP_CUSTOM_ID, emoji: { name: '📖' } };

/** กล่องสอนการใช้งาน (เห็นคนเดียว) — ใช้ทั้งตอนกดปุ่มและ /remind help */
export function buildHelpMessage(settings: BotSettings) {
  const inner: unknown[] = [
    { type: TEXT, content: '## 📖 วิธีใช้ knock-knock\nบอทแจ้งเตือนประจำวัน ตั้งเวลา จำนวนรอบ วันที่ซ้ำ และแท็กคน/ยศได้' },
    { type: SEPARATOR, divider: true, spacing: 1 },
    {
      type: TEXT,
      content: [
        '### ➕ ตั้งแจ้งเตือน',
        '`/remind add` แล้วกรอกช่องต่อไปนี้',
        '• **title** เรื่องที่จะเตือน *(ต้องใส่)*',
        '• **times** เวลา คั่นด้วยจุลภาค เช่น `09:00,13:00,17:00`',
        '• หรือ **start** + **every** + **rounds** เช่น เริ่ม `08:00` ทุก `120` นาที `4` รอบ',
        '• **days** วันที่ซ้ำ: `ทุกวัน` · `จ-ศ` · `ส-อา` · `จ,พ,ศ` *(เว้นว่าง = ทุกวัน)*',
        '• **message** ข้อความในกล่อง',
        '• **channel** ห้องที่จะส่ง *(เว้นว่าง = ห้องนี้)*',
        '• **tag** คน/ยศที่จะแท็ก พิมพ์ `@` แล้วเลือกได้หลายอัน เช่น `@ทีมงาน @ยูมี่` หรือ `@everyone`',
      ].join('\n'),
    },
    {
      type: TEXT,
      content: [
        '**ตัวอย่าง**',
        '```',
        '/remind add title:ส่งรายงาน times:09:00,17:00 days:จ-ศ message:อย่าลืมส่งก่อนเลิกงาน tag:@ทีมงาน',
        '```',
      ].join('\n'),
    },
    { type: SEPARATOR, divider: true, spacing: 1 },
    {
      type: TEXT,
      content: [
        '### 🛠️ จัดการ',
        '`/remind list` ดูทั้งหมด พร้อมเลข id',
        '`/remind tag id tag` เปลี่ยนคน/ยศที่แท็ก *(เว้น tag ว่าง = ไม่แท็กใคร)*',
        '`/remind panel id` วางแผงปุ่มให้สมาชิกกด **รับยศ** เพื่อรับแจ้งเตือนเอง',
        '`/remind test id` ส่งให้ดูทันที 1 ครั้ง',
        '`/remind pause id` · `/remind resume id` พัก / เปิดต่อ',
        '`/remind remove id` ลบ',
        '`/remind timezone zone` เขตเวลาของเซิร์ฟ *(ค่าเริ่มต้น Asia/Bangkok)*',
      ].join('\n'),
    },
    {
      type: TEXT,
      content:
        '-# คำสั่ง /remind ใช้ได้เฉพาะคนที่มีสิทธิ์ Manage Server — แอดมินเปิดให้ยศอื่นได้ที่ Server Settings › Integrations › knock-knock\n' +
        '-# บอทต้องมีสิทธิ์ View Channel + Send Messages ในห้องที่ส่ง\n' +
        '-# ปุ่มรับยศ: บอทต้องมีสิทธิ์ Manage Roles และยศของบอทต้องอยู่สูงกว่ายศที่แจก',
    },
  ];

  const links = [];
  if (isHttpUrl(settings.donate_url)) links.push(linkButton('Donate', settings.donate_url, '💖'));
  if (isHttpUrl(settings.contact_url)) links.push(linkButton('ติดต่อ', settings.contact_url, '📩'));
  if (links.length) inner.push({ type: ACTION_ROW, components: links });

  return {
    flags: IS_COMPONENTS_V2 | EPHEMERAL,
    components: [{ type: CONTAINER, accent_color: accent(settings), components: inner }],
    allowed_mentions: { parse: [] },
  };
}
