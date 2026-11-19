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
  call_text?: string | null; // บรรทัดเรียกที่ตั้งเอง (ว่าง = อัตโนมัติ)
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

// อักษรตกแต่งน่ารัก ๆ ใช้ร่วมทุกการ์ด (ผู้ใช้เลือกแบบเอง 19 พ.ย. 2569)
const BUNNY = '₍ᐢ. .ᐢ₎';
const DIVIDER = '⋆｡ﾟ☁︎｡⋆｡ ﾟ☾ ﾟ｡⋆｡ﾟ☁︎｡⋆';
const TITLE_FACE = '𐔌՞. .՞𐦯';

/** บรรทัดเรียกแบบอัตโนมัติ: "อย่าลืม<ข้อความ> น้า" · ไม่มีข้อความ = "ถึงเวลา <เรื่อง> แล้วน้า" */
export function callLine(r: { title: string; message: string | null }): string {
  const first = r.message?.trim().split('\n')[0]?.trim();
  return first ? `อย่าลืม${clip(first, 80)} น้า` : `ถึงเวลา ${clip(r.title, 80)} แล้วน้า`;
}

/** บรรทัดเหนือการ์ด (ไม่รวมแท็ก) — ตั้งเองได้ ไม่ตั้ง = 🔔 + แบบอัตโนมัติ + ตกแต่ง */
export function topLine(r: { title: string; message: string | null; call_text?: string | null }): string {
  const own = r.call_text?.trim();
  return own ? clip(own, 300) : `🔔 ${callLine(r)} ⋆. 𐙚 ˚`;
}

/** ข้อความหลายบรรทัด → แถบอ้างอิง > ทุกบรรทัด */
function quote(text: string): string {
  return text
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
}

export function buildReminderMessage(
  r: ReminderView,
  slot: Slot,
  ad: AdRow | null,
  settings: BotSettings,
) {
  const inner: unknown[] = [];

  inner.push({
    type: TEXT,
    content: `-# ⋆｡˚ 🔔 KNOCK KNOCK · แจ้งเตือนประจำวัน ˚｡⋆\n## ${clip(r.title, 100)} ${TITLE_FACE}`,
  });

  if (r.message?.trim()) {
    inner.push({ type: TEXT, content: quote(`${clip(r.message.trim(), 1500)} ♡`) });
  }

  // บรรทัดข้อมูลบรรทัดเดียว ตัวหนา เว้นช่องกว้าง (แบบที่ผู้ใช้เขียนมา 19 พ.ย. 2569)
  const info = [
    `**${slot.hm}**`,
    slot.total > 1 ? `**รอบ ${slot.round}/${slot.total}**` : null,
    `**${formatDays(r.days)}**`,
    `**โดย**  <@${r.created_by}>`,
  ].filter(Boolean);
  inner.push({ type: TEXT, content: `˚₊‧꒰ა  ⏰  ${info.join('  ·  ')}  ໒꒱  ‧₊˚` });

  inner.push({ type: SEPARATOR, divider: true, spacing: 1 });

  // แบนเนอร์อยู่ระหว่างข้อความกับปุ่ม
  if (ad && isHttpUrl(ad.image_url)) {
    inner.push({ type: MEDIA_GALLERY, items: [{ media: { url: ad.image_url }, description: ad.label ?? undefined }] });
    inner.push({ type: TEXT, content: `-# 📢 โฆษณา${ad.label ? ` ⋆ ${clip(ad.label, 80)}` : ''} ♡` });
  }

  // ปุ่มทั้งหมดแถวเดียว (สูงสุด 5): รับยศ · วิธีใช้ · Donate · ติดต่อ · ลิงก์โฆษณา
  const buttons: unknown[] = [];
  const roleBtn = roleButton(r);
  if (roleBtn) buttons.push(roleBtn);
  buttons.push(HELP_BUTTON);
  if (isHttpUrl(settings.donate_url)) buttons.push(linkButton('Donate', settings.donate_url, '💖'));
  if (isHttpUrl(settings.contact_url)) buttons.push(linkButton('ติดต่อ', settings.contact_url, '💌'));
  if (ad && isHttpUrl(ad.link_url)) buttons.push(linkButton(clip(ad.label || 'ดูเพิ่มเติม', 80), ad.link_url, '✨'));
  inner.push({ type: ACTION_ROW, components: buttons });

  // แถวจัดการ: ใครกดก็ได้ แต่บอทยอมให้แก้/ลบเฉพาะคนตั้งหรือคนมีสิทธิ์ Manage Server
  if (r.id) {
    inner.push({
      type: ACTION_ROW,
      components: [
        { type: BUTTON, style: 2, label: 'แก้ไข', custom_id: `kk:edit:${r.id}`, emoji: { name: '✏️' } },
        { type: BUTTON, style: 2, label: 'ลบแจ้งเตือนนี้', custom_id: `kk:del:${r.id}`, emoji: { name: '🗑️' } },
      ],
    });
  }

  const components: unknown[] = [];
  // ข้อความ V2 ใส่ content ไม่ได้ — @ คนไว้เหนือการ์ด ให้แจ้งเตือนเด้งจริง
  // แท็กอยู่หน้าบรรทัดเสมอ ให้เด้งแจ้งเตือน · ไม่มีแท็กแต่ตั้งบรรทัดเองไว้ ก็ยังโชว์
  if (r.mention || r.call_text?.trim()) {
    components.push({ type: TEXT, content: [r.mention, topLine(r)].filter(Boolean).join(' ') });
  }
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
          { type: TEXT, content: `-# ⋆｡˚ 🔔 KNOCK KNOCK · รับแจ้งเตือน ˚｡⋆\n## ₊˚⊹ ${clip(r.title, 100)} ⊹˚₊` },
          {
            type: TEXT,
            content: [
              `กดปุ่มด้านล่างเพื่อรับยศ ${roles.join(' ')} แล้วบอทจะแท็กคุณทุกครั้งที่ถึงเวลา ${BUNNY}`,
              'กดอีกครั้งเพื่อยกเลิก ♡',
              DIVIDER,
            ].join('\n'),
          },
          { type: TEXT, content: `⏰ **เวลา** ⊹ \`${r.times.join(' · ')}\`\n📅 **ซ้ำ** ⊹ \`${formatDays(r.days)}\`` },
          ...(btn ? [{ type: ACTION_ROW, components: [btn, HELP_BUTTON] }] : []),
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

// ---------- ปุ่มและกล่อง "วิธีใช้" ----------

export const HELP_CUSTOM_ID = 'kk:help';

const HELP_BUTTON = { type: BUTTON, style: 1, label: 'คำสั่ง & วิธีใช้', custom_id: HELP_CUSTOM_ID, emoji: { name: '📖' } };

/** กล่องสอนการใช้งาน (เห็นคนเดียว) — ใช้ทั้งตอนกดปุ่มและ /remind help */
export function buildHelpMessage(settings: BotSettings) {
  const inner: unknown[] = [
    {
      type: TEXT,
      content: [
        `-# ⋆｡˚ 🔔 KNOCK KNOCK · วิธีใช้ ˚｡⋆`,
        `## 📖 วิธีใช้ knock-knock ${TITLE_FACE}`,
        'บอทแจ้งเตือนประจำวัน ตั้งได้ว่าเตือนเรื่องอะไร กี่โมง กี่รอบต่อวัน ซ้ำวันไหน และแท็กคน/ยศให้ ♡',
        '-# ⋆. 𐙚 ˚ ตั้งได้**หลายอัน** (สูงสุด 25 ต่อเซิร์ฟ) แต่ละอันมีเลข **id** ของตัวเอง — ช่อง id ในทุกคำสั่ง **พิมพ์ชื่อแล้วเลือกจากรายการ**ได้เลย ไม่ต้องจำเลข',
      ].join('\n'),
    },
    { type: SEPARATOR, divider: true, spacing: 1 },
    {
      type: TEXT,
      content: [
        '### ➕ ตั้งแจ้งเตือนใหม่',
        '`/remind add` แล้วกรอกช่องต่อไปนี้',
        '• **title** เรื่องที่จะเตือน *(ต้องใส่)*',
        '• **times** เวลา คั่นด้วยจุลภาค เช่น `09:00,13:00,17:00`',
        '• หรือ **start** + **every** + **rounds** เช่น เริ่ม `08:00` ทุก `120` นาที `4` รอบ',
        '• **days** วันที่ซ้ำ: `ทุกวัน` · `จ-ศ` · `ส-อา` · `จ,พ,ศ` *(เว้นว่าง = ทุกวัน)*',
        '• **message** ข้อความในกล่อง',
        '• **channel** ห้องที่จะส่ง *(เว้นว่าง = ห้องนี้)*',
        '• **tag** คน/ยศที่จะแท็ก พิมพ์ `@` แล้วเลือกได้หลายอัน เช่น `@ทีมงาน @ยูมี่` หรือ `@everyone`',
        '• **call** บรรทัดเหนือการ์ดต่อจากแท็ก เช่น `🔔 ตื่นได้แล้วน้า~ ⋆. 𐙚 ˚` *(เว้นว่าง = "อย่าลืม<ข้อความ> น้า" อัตโนมัติ)*',
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
        '### 🔘 ปุ่มบนการ์ดแจ้งเตือน',
        '🔔 **รับ / ยกเลิกแจ้งเตือน** — กดรับยศ แล้วบอทจะแท็กคุณทุกรอบ · กดอีกครั้งเพื่อเลิก *(มีเมื่อแจ้งเตือนนั้นแท็กยศ)*',
        '📖 **คำสั่ง & วิธีใช้** — เปิดกล่องนี้',
        '✏️ **แก้ไข** — เปิดฟอร์มแก้ เรื่อง · บรรทัดเรียก · ข้อความ · เวลา · วันที่ซ้ำ',
        '🗑️ **ลบแจ้งเตือนนี้** — ถามยืนยันก่อน ลบแล้วกู้คืนไม่ได้',
        '-# 🔒 เพิ่ม · แก้ไข · ลบ ได้เฉพาะผู้ดูแลเซิร์ฟ (สิทธิ์ Administrator หรือ Manage Server) · ปุ่มรับยศกับวิธีใช้กดได้ทุกคน',
      ].join('\n'),
    },
    { type: SEPARATOR, divider: true, spacing: 1 },
    {
      type: TEXT,
      content: [
        '### 🛠️ คำสั่งจัดการ',
        '`/remind list` ดูแจ้งเตือนทั้งหมดของเซิร์ฟ พร้อมเลข id',
        '`/remind edit` แก้ไข — กรอกแค่ id = เปิดฟอร์ม · กรอกช่องไหน = แก้ช่องนั้น (ย้ายห้องได้ด้วย `channel`)',
        '`/remind tag` เปลี่ยนคน/ยศที่แท็ก *(เว้น tag ว่าง = ไม่แท็กใคร)*',
        '`/remind panel` วางแผงปุ่มให้สมาชิกกดรับยศล่วงหน้า',
        '`/remind test` ส่งการ์ดให้ดูทันที 1 ครั้ง',
        '`/remind pause` · `/remind resume` พัก / เปิดต่อ',
        '`/remind remove` ลบ',
        '`/remind timezone` เขตเวลาของเซิร์ฟ *(ค่าเริ่มต้น Asia/Bangkok)*',
      ].join('\n'),
    },
    { type: SEPARATOR, divider: true, spacing: 1 },
    {
      type: TEXT,
      content:
        '-# ˚₊‧꒰ა คำสั่ง /remind ใช้ได้เฉพาะคนที่มีสิทธิ์ Manage Server — แอดมินเปิดให้ยศอื่นได้ที่ Server Settings › Integrations › knock-knock\n' +
        '-# ˚₊‧꒰ა บอทต้องมีสิทธิ์ View Channel + Send Messages ในห้องที่ส่ง · ปุ่มรับยศต้องมีสิทธิ์ Manage Roles และยศบอทต้องอยู่สูงกว่ายศที่แจก\n' +
        '-# ˚₊‧꒰ა บอทติดบั๊ก · สอบถาม · ลงโฆษณา ติดต่อ Discord : @luv4yumie ⋆. 𐙚 ˚',
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
