// ตรรกะเวลา/วัน ล้วน ๆ (ไม่แตะ Discord หรือฐานข้อมูล) — เทสต์ได้ตรง ๆ

/** ข้อความผิดพลาดที่ส่งให้ผู้ใช้อ่านได้ตรง ๆ */
export class InputError extends Error {}

export const ALL_DAYS = 0b1111111;
export const WEEKDAYS = 0b0111110; // จ–ศ
export const WEEKEND = 0b1000001; // ส, อา

const DAY_SHORT_TH = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

// ชื่อที่รับได้ของแต่ละวัน (index = วันในสัปดาห์ 0 = อาทิตย์)
const DAY_ALIASES: string[][] = [
  ['อา', 'อาทิตย์', 'sun', 'su', 'sunday'],
  ['จ', 'จันทร์', 'mon', 'mo', 'monday'],
  ['อ', 'อังคาร', 'tue', 'tu', 'tuesday'],
  ['พ', 'พุธ', 'wed', 'we', 'wednesday'],
  ['พฤ', 'พฤหัส', 'พฤหัสบดี', 'thu', 'th', 'thursday'],
  ['ศ', 'ศุกร์', 'fri', 'fr', 'friday'],
  ['ส', 'เสาร์', 'sat', 'sa', 'saturday'],
];

const PRESETS: Record<string, number> = {
  'ทุกวัน': ALL_DAYS,
  everyday: ALL_DAYS,
  daily: ALL_DAYS,
  all: ALL_DAYS,
  'วันทำงาน': WEEKDAYS,
  weekdays: WEEKDAYS,
  weekday: WEEKDAYS,
  'เสาร์อาทิตย์': WEEKEND,
  'วันหยุด': WEEKEND,
  weekend: WEEKEND,
  weekends: WEEKEND,
};

function dayIndex(token: string): number {
  const t = token.replace(/\./g, '').toLowerCase();
  const i = DAY_ALIASES.findIndex((names) => names.includes(t));
  if (i < 0) throw new InputError(`ไม่รู้จักวัน "${token}"`);
  return i;
}

/** "ทุกวัน" · "จ-ศ" · "จ,พ,ศ" · "ส-อา" · "mon,wed" → bitmask */
export function parseDays(input: string | undefined | null): number {
  const raw = (input ?? '').trim().toLowerCase();
  if (!raw) return ALL_DAYS;
  const compact = raw.replace(/\s+/g, '');
  if (PRESETS[compact] !== undefined) return PRESETS[compact];

  let mask = 0;
  const tokens = raw.replace(/\s*-\s*/g, '-').split(/[,\s]+/).filter(Boolean);
  for (const tok of tokens) {
    if (PRESETS[tok] !== undefined) {
      mask |= PRESETS[tok];
      continue;
    }
    const range = tok.split('-');
    if (range.length === 2) {
      const a = dayIndex(range[0]);
      const b = dayIndex(range[1]);
      // วนข้ามสัปดาห์ได้ เช่น ส-อา
      for (let d = a; ; d = (d + 1) % 7) {
        mask |= 1 << d;
        if (d === b) break;
      }
    } else if (range.length === 1) {
      mask |= 1 << dayIndex(tok);
    } else {
      throw new InputError(`รูปแบบวันไม่ถูก "${tok}"`);
    }
  }
  if (!mask) throw new InputError('ต้องเลือกอย่างน้อย 1 วัน');
  return mask;
}

export function formatDays(mask: number): string {
  if (mask === ALL_DAYS) return 'ทุกวัน';
  if (mask === WEEKDAYS) return 'จ.–ศ.';
  if (mask === WEEKEND) return 'ส.–อา.';
  // เริ่มที่จันทร์ อาทิตย์ไว้ท้าย
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => mask & (1 << d)).map((d) => DAY_SHORT_TH[d]).join(' ');
}

function toMinutes(hm: string): number {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(hm.trim());
  if (!m) throw new InputError(`เวลาไม่ถูก "${hm}" (ใช้รูปแบบ 09:00)`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new InputError(`เวลาไม่ถูก "${hm}"`);
  return h * 60 + min;
}

function fromMinutes(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export const MAX_ROUNDS = 24;

/** "9:00, 13.30 ,17:00" → ["09:00","13:30","17:00"] (เรียง ตัดซ้ำ) */
export function parseTimes(input: string): string[] {
  const parts = input.split(/[,\s]+/).filter(Boolean);
  if (!parts.length) throw new InputError('ต้องใส่เวลาอย่างน้อย 1 เวลา');
  const mins = [...new Set(parts.map(toMinutes))].sort((a, b) => a - b);
  if (mins.length > MAX_ROUNDS) throw new InputError(`ตั้งได้ไม่เกิน ${MAX_ROUNDS} รอบต่อวัน`);
  return mins.map(fromMinutes);
}

/** เริ่ม 08:00 ทุก 120 นาที 4 รอบ → ["08:00","10:00","12:00","14:00"] */
export function buildTimes(start: string, everyMinutes: number, rounds: number): string[] {
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS) {
    throw new InputError(`จำนวนรอบต้องอยู่ระหว่าง 1–${MAX_ROUNDS}`);
  }
  if (rounds > 1 && (!Number.isInteger(everyMinutes) || everyMinutes < 1)) {
    throw new InputError('ระยะห่างต้องเป็นนาทีอย่างน้อย 1');
  }
  const s = toMinutes(start);
  const last = s + everyMinutes * (rounds - 1);
  if (last >= 24 * 60) throw new InputError(`รอบสุดท้ายเลยเที่ยงคืน (${rounds} รอบ ห่าง ${everyMinutes} นาที)`);
  return Array.from({ length: rounds }, (_, i) => fromMinutes(s + everyMinutes * i));
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface LocalParts {
  date: string; // YYYY-MM-DD
  hm: string; // HH:MM
  weekday: number; // 0 = อาทิตย์
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmtCache = new Map<string, Intl.DateTimeFormat>();

export function localParts(at: Date, tz: string): LocalParts {
  let fmt = fmtCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    });
    fmtCache.set(tz, fmt);
  }
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(at)) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, weekday: WD[p.weekday] };
}

export interface DueSlot {
  slot: string; // "YYYY-MM-DD HH:MM" ตามเวลาของเซิร์ฟ — ใช้กันส่งซ้ำ
  hm: string;
  round: number; // 1-based
  total: number;
}

/**
 * รอบที่ถึงเวลาภายใน `lookbackMinutes` นาทีล่าสุด (เผื่อ cron มาช้า)
 * ไม่นับรอบที่อยู่ก่อนเวลาสร้างแจ้งเตือน
 */
export function dueSlots(
  r: { times: string[]; days: number; createdAtMs: number },
  now: Date,
  tz: string,
  lookbackMinutes = 5,
): DueSlot[] {
  const out: DueSlot[] = [];
  const nowMinute = Math.floor(now.getTime() / 60_000) * 60_000;
  const createdMinute = Math.floor(r.createdAtMs / 60_000) * 60_000;
  for (let k = 0; k < lookbackMinutes; k++) {
    const t = nowMinute - k * 60_000;
    if (t < createdMinute) break;
    const lp = localParts(new Date(t), tz);
    if (!(r.days & (1 << lp.weekday))) continue;
    const idx = r.times.indexOf(lp.hm);
    if (idx < 0) continue;
    out.push({ slot: `${lp.date} ${lp.hm}`, hm: lp.hm, round: idx + 1, total: r.times.length });
  }
  return out;
}

export interface AdRow {
  id: number;
  image_url: string;
  link_url: string | null;
  label: string | null;
  starts_on: string | null;
  ends_on: string | null;
  active: number;
}

/** แบนเนอร์ของวันนี้ — ทุกเซิร์ฟเห็นอันเดียวกันทั้งวัน แล้วหมุนไปอันถัดไปวันรุ่งขึ้น */
export function pickAd(ads: AdRow[], today: string): AdRow | null {
  const live = ads
    .filter((a) => a.active && (!a.starts_on || a.starts_on <= today) && (!a.ends_on || a.ends_on >= today))
    .sort((a, b) => a.id - b.id);
  if (!live.length) return null;
  const dayNumber = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86_400_000);
  return live[dayNumber % live.length];
}

/** datetime('now') ของ SQLite ("YYYY-MM-DD HH:MM:SS" UTC) → ms */
export function sqliteUtcToMs(s: string): number {
  return Date.parse(s.replace(' ', 'T') + 'Z');
}
