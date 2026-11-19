// แก้ไข / ลบ แจ้งเตือน — ใช้ทั้งปุ่มบนการ์ด, ฟอร์ม (modal) และ /remind edit
import type { ReminderRow } from './db';
import type { Env } from './discord';
import { EPHEMERAL } from './message';
import { ALL_DAYS, buildTimes, formatDays, InputError, parseDays, parseTimes, WEEKDAYS, WEEKEND } from './schedule';

type Json = Record<string, unknown>;

export const EDIT_PREFIX = 'kk:edit:'; // ปุ่ม ✏️ → เปิดฟอร์ม
export const EDIT_MODAL_PREFIX = 'kk:editm:'; // ส่งฟอร์ม
export const DEL_PREFIX = 'kk:del:'; // ปุ่ม 🗑️ → ถามยืนยัน
export const DEL_YES_PREFIX = 'kk:delyes:';
export const DEL_NO = 'kk:delno';

const MODAL = 9;
const UPDATE_MESSAGE = 7;
const REPLY = 4;

const ADMINISTRATOR = 1n << 3n;
const MANAGE_GUILD = 1n << 5n;

/** แก้/ลบได้: แอดมิน · คนมีสิทธิ์ Manage Server · คนที่ตั้งแจ้งเตือนนั้นเอง */
export function canManage(permissions: string | undefined, userId: string, r: Pick<ReminderRow, 'created_by'>): boolean {
  if (r.created_by === userId) return true;
  try {
    const p = BigInt(permissions ?? '0');
    return (p & (ADMINISTRATOR | MANAGE_GUILD)) !== 0n;
  } catch {
    return false;
  }
}

/** bitmask → ข้อความที่พิมพ์กลับเข้า parseDays ได้ */
export function daysInput(mask: number): string {
  if (mask === ALL_DAYS) return 'ทุกวัน';
  if (mask === WEEKDAYS) return 'จ-ศ';
  if (mask === WEEKEND) return 'ส-อา';
  const names = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => mask & (1 << d)).map((d) => names[d]).join(',');
}

// ฟอร์มใช้ Label (type 18) ห่อแต่ละช่อง — ใส่ dropdown ในฟอร์มได้
const LABEL = 18;
const TEXT_INPUT = 4;
const STRING_SELECT = 3;

const textInput = (
  id: string,
  label: string,
  value: string,
  opts: { paragraph?: boolean; required?: boolean; max: number; placeholder?: string; description?: string },
) => ({
  type: LABEL,
  label,
  ...(opts.description ? { description: opts.description } : {}),
  component: {
    type: TEXT_INPUT,
    custom_id: id,
    style: opts.paragraph ? 2 : 1,
    value: value.slice(0, opts.max),
    required: opts.required ?? true,
    max_length: opts.max,
    ...(opts.placeholder ? { placeholder: opts.placeholder } : {}),
  },
});

const DAY_OPTIONS: { day: number; label: string; emoji: string }[] = [
  { day: 1, label: 'จันทร์', emoji: '💛' },
  { day: 2, label: 'อังคาร', emoji: '🩷' },
  { day: 3, label: 'พุธ', emoji: '💚' },
  { day: 4, label: 'พฤหัสบดี', emoji: '🧡' },
  { day: 5, label: 'ศุกร์', emoji: '💙' },
  { day: 6, label: 'เสาร์', emoji: '💜' },
  { day: 0, label: 'อาทิตย์', emoji: '❤️' },
];

/** dropdown เลือกวันที่ซ้ำได้หลายวัน ติ๊กตามค่าเดิมไว้ */
const daysSelect = (mask: number) => ({
  type: LABEL,
  label: 'วันที่ซ้ำ',
  description: 'ติ๊กได้หลายวัน · เลือกครบ 7 วัน = ทุกวัน',
  component: {
    type: STRING_SELECT,
    custom_id: 'days',
    placeholder: 'เลือกวันที่จะเตือน',
    min_values: 1,
    max_values: 7,
    required: true,
    options: DAY_OPTIONS.map((d) => ({
      label: d.label,
      value: String(d.day),
      emoji: { name: d.emoji },
      default: (mask & (1 << d.day)) !== 0,
    })),
  },
});

/** ฟอร์มแก้ไข เติมค่าเดิมไว้ให้ */
export function editModal(r: ReminderRow): Json {
  return {
    type: MODAL,
    data: {
      custom_id: `${EDIT_MODAL_PREFIX}${r.id}`,
      title: `✏️ แก้ไขแจ้งเตือน #${r.id}`.slice(0, 45),
      components: [
        textInput('title', 'เรื่อง', r.title, { max: 100 }),
        textInput('message', 'ข้อความ', r.message ?? '', {
          paragraph: true,
          required: false,
          max: 1500,
          description: 'เว้นว่างได้',
        }),
        textInput('times', 'เวลา', (JSON.parse(r.times) as string[]).join(','), {
          max: 200,
          placeholder: '09:00,13:00,17:00',
          description: 'คั่นด้วยจุลภาค เช่น 09:00,13:00,17:00',
        }),
        daysSelect(r.days),
      ],
    },
  };
}

/** ช่องในฟอร์มที่ส่งกลับมา — แบบ Label (component) หรือแถวแบบเก่า (components) */
export type ModalField = { custom_id: string; value?: string; values?: string[] };
export type ModalRow = { component?: ModalField; components?: ModalField[] };

export interface EditFields {
  title?: string;
  message?: string | null;
  times?: string[];
  days?: number;
  channel_id?: string;
}

/** อ่านค่าจากฟอร์มที่ส่งมา */
export function readModal(rows: ModalRow[]): EditFields {
  const fields: ModalField[] = [];
  for (const row of rows ?? []) {
    if (row.component) fields.push(row.component);
    for (const c of row.components ?? []) fields.push(c);
  }
  const v: Record<string, string> = {};
  let dayValues: string[] | null = null;
  for (const f of fields) {
    if (f.values) dayValues = f.values;
    else v[f.custom_id] = (f.value ?? '').trim();
  }
  if (!v.title) throw new InputError('ต้องใส่เรื่อง');
  let days: number;
  if (dayValues) {
    days = dayValues.reduce((m, d) => m | (1 << Number(d)), 0);
    if (!days) throw new InputError('ต้องเลือกอย่างน้อย 1 วัน');
  } else {
    days = parseDays(v.days);
  }
  return {
    title: v.title,
    message: v.message || null,
    times: parseTimes(v.times ?? ''),
    days,
  };
}

/** รายการแนะนำของช่อง days ในคำสั่ง — พิมพ์เองที่อ่านได้ก็ขึ้นเป็นตัวเลือกแรก */
export function dayChoices(typed: string) {
  const presets = [
    { name: '🗓️ ทุกวัน', value: 'ทุกวัน' },
    { name: '💼 จันทร์–ศุกร์ (วันทำงาน)', value: 'จ-ศ' },
    { name: '🌸 เสาร์–อาทิตย์', value: 'ส-อา' },
    { name: '✨ จันทร์, พุธ, ศุกร์', value: 'จ,พ,ศ' },
    { name: '✨ อังคาร, พฤหัสบดี', value: 'อ,พฤ' },
    { name: '✨ จันทร์–เสาร์', value: 'จ-ส' },
  ];
  const t = typed.trim();
  if (!t) return presets;
  let own: { name: string; value: string }[] = [];
  try {
    own = [{ name: `✅ ${formatDays(parseDays(t))} (ที่พิมพ์)`, value: t.slice(0, 100) }];
  } catch {
    // อ่านไม่ออก — ไม่เสนอค่าที่ผิด โชว์แต่ตัวเลือกสำเร็จรูปให้กดแทน
  }
  const q = t.toLowerCase();
  const matched = presets.filter((p) => p.name.toLowerCase().includes(q) || p.value.includes(q));
  return [...own, ...(matched.length ? matched : presets)].slice(0, 25);
}

/** อ่านค่าจาก /remind edit — ช่องที่ไม่กรอก = คงเดิม */
export function readEditOptions(o: Record<string, string | number | undefined>): EditFields {
  const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '');
  const f: EditFields = {};
  if (s('title')) f.title = s('title');
  if (o.message !== undefined) f.message = s('message') || null;
  if (s('times')) f.times = parseTimes(s('times'));
  else if (s('start')) f.times = buildTimes(s('start'), Number(o.every ?? 0), Number(o.rounds ?? 1));
  if (s('days')) f.days = parseDays(s('days'));
  if (s('channel')) f.channel_id = s('channel');
  return f;
}

export async function applyEdit(env: Env, r: ReminderRow, f: EditFields): Promise<ReminderRow> {
  const next: ReminderRow = {
    ...r,
    title: f.title ?? r.title,
    message: f.message !== undefined ? f.message : r.message,
    times: f.times ? JSON.stringify(f.times) : r.times,
    days: f.days ?? r.days,
    channel_id: f.channel_id ?? r.channel_id,
  };
  await env.DB.prepare('UPDATE reminders SET title = ?, message = ?, times = ?, days = ?, channel_id = ?, last_error = NULL WHERE id = ?')
    .bind(next.title, next.message, next.times, next.days, next.channel_id, r.id)
    .run();
  return next;
}

export function editedReply(r: ReminderRow): Json {
  return {
    type: REPLY,
    data: {
      flags: EPHEMERAL,
      allowed_mentions: { parse: [] },
      content: [
        `✏️ แก้ไข **#${r.id} ${r.title}** แล้ว ₍ᐢ. .ᐢ₎`,
        `⏰ ${(JSON.parse(r.times) as string[]).join(', ')} · 📅 ${formatDays(r.days)} · ส่งที่ <#${r.channel_id}>`,
        r.message ? `> ${r.message.split('\n')[0]}` : '',
        '-# การ์ดที่ส่งไปแล้วไม่เปลี่ยน — รอบถัดไปจะใช้ค่าใหม่',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  };
}

/** กด 🗑️ → ถามยืนยันก่อน (เห็นคนเดียว) */
export function deleteConfirm(r: ReminderRow): Json {
  return {
    type: REPLY,
    data: {
      flags: EPHEMERAL,
      allowed_mentions: { parse: [] },
      content: `ลบแจ้งเตือน **#${r.id} ${r.title}** ใช่ไหม? ลบแล้วจะไม่เตือนอีก และกู้คืนไม่ได้`,
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 4, label: 'ลบเลย', custom_id: `${DEL_YES_PREFIX}${r.id}`, emoji: { name: '🗑️' } },
            { type: 2, style: 2, label: 'ยกเลิก', custom_id: DEL_NO },
          ],
        },
      ],
    },
  };
}

export async function deleteReminder(env: Env, r: ReminderRow): Promise<Json> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reminders WHERE id = ?').bind(r.id),
    env.DB.prepare('DELETE FROM sends WHERE reminder_id = ?').bind(r.id),
  ]);
  return { type: UPDATE_MESSAGE, data: { content: `🗑️ ลบ **#${r.id} ${r.title}** แล้ว`, components: [] } };
}

export const deleteCancelled = (): Json => ({ type: UPDATE_MESSAGE, data: { content: 'ยกเลิกแล้ว ไม่ได้ลบอะไร ♡', components: [] } });

/** รายการให้เลือกในช่อง id — พิมพ์ชื่อหรือเลขก็หาเจอ */
export function idChoices(rows: Pick<ReminderRow, 'id' | 'title' | 'times' | 'days' | 'active'>[], typed: string) {
  const q = typed.trim().replace(/^#/, '').toLowerCase();
  return rows
    .filter((r) => !q || String(r.id).startsWith(q) || r.title.toLowerCase().includes(q))
    .slice(0, 25)
    .map((r) => ({
      name: `${r.active ? '' : '⏸️ '}#${r.id} ${r.title} · ${(JSON.parse(r.times) as string[]).join(', ')} · ${formatDays(r.days)}`.slice(0, 100),
      value: String(r.id),
    }));
}
