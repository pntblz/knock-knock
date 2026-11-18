import { describe, expect, it } from 'vitest';
import {
  ALL_DAYS,
  WEEKDAYS,
  WEEKEND,
  buildTimes,
  dueSlots,
  formatDays,
  localParts,
  parseDays,
  parseTimes,
  pickAd,
  sqliteUtcToMs,
  type AdRow,
} from '../src/schedule';
import { allowedMentions, buildReminderMessage } from '../src/message';

describe('parseDays', () => {
  it('รับค่าลัด', () => {
    expect(parseDays('')).toBe(ALL_DAYS);
    expect(parseDays('ทุกวัน')).toBe(ALL_DAYS);
    expect(parseDays('weekdays')).toBe(WEEKDAYS);
    expect(parseDays('จ-ศ')).toBe(WEEKDAYS);
    expect(parseDays('จ. - ศ.')).toBe(WEEKDAYS);
  });
  it('ช่วงข้ามสัปดาห์', () => {
    expect(parseDays('ส-อา')).toBe(WEEKEND);
  });
  it('รายวัน ไทย/อังกฤษ + แยก พ กับ พฤ', () => {
    expect(parseDays('จ,พ,ศ')).toBe((1 << 1) | (1 << 3) | (1 << 5));
    expect(parseDays('พฤ')).toBe(1 << 4);
    expect(parseDays('mon wed')).toBe((1 << 1) | (1 << 3));
  });
  it('วันที่ไม่รู้จัก', () => {
    expect(() => parseDays('xyz')).toThrow('ไม่รู้จักวัน');
  });
  it('แสดงผล', () => {
    expect(formatDays(WEEKDAYS)).toBe('จ.–ศ.');
    expect(formatDays((1 << 0) | (1 << 1))).toBe('จ. อา.');
  });
});

describe('times', () => {
  it('parseTimes เรียงและตัดซ้ำ', () => {
    expect(parseTimes('17:00, 9:00 9.00,13.30')).toEqual(['09:00', '13:30', '17:00']);
    expect(() => parseTimes('25:00')).toThrow();
  });
  it('buildTimes', () => {
    expect(buildTimes('08:00', 120, 4)).toEqual(['08:00', '10:00', '12:00', '14:00']);
    expect(buildTimes('08:00', 0, 1)).toEqual(['08:00']);
    expect(() => buildTimes('20:00', 120, 4)).toThrow('เที่ยงคืน');
  });
});

describe('dueSlots', () => {
  const tz = 'Asia/Bangkok';
  // 2026-11-18 (พุธ) 09:00 เวลาไทย = 02:00 UTC
  const at = (utc: string) => new Date(utc);
  const r = { times: ['09:00', '13:00'], days: WEEKDAYS, createdAtMs: Date.parse('2026-11-01T00:00:00Z') };

  it('localParts ใช้เวลาไทย', () => {
    expect(localParts(at('2026-11-18T02:00:00Z'), tz)).toEqual({ date: '2026-11-18', hm: '09:00', weekday: 3 });
  });
  it('ถึงเวลาพอดี', () => {
    expect(dueSlots(r, at('2026-11-18T02:00:30Z'), tz)).toEqual([
      { slot: '2026-11-18 09:00', hm: '09:00', round: 1, total: 2 },
    ]);
  });
  it('cron มาช้า 3 นาทีก็ยังเจอ', () => {
    expect(dueSlots(r, at('2026-11-18T02:03:00Z'), tz)).toHaveLength(1);
    expect(dueSlots(r, at('2026-11-18T02:06:00Z'), tz)).toHaveLength(0);
  });
  it('ไม่ส่งวันเสาร์ถ้าตั้ง จ-ศ', () => {
    expect(dueSlots(r, at('2026-11-21T02:00:00Z'), tz)).toHaveLength(0);
  });
  it('ไม่ย้อนส่งรอบก่อนเวลาสร้าง', () => {
    const fresh = { ...r, createdAtMs: sqliteUtcToMs('2026-11-18 02:02:10') };
    expect(dueSlots(fresh, at('2026-11-18T02:03:00Z'), tz)).toHaveLength(0);
  });
});

describe('pickAd', () => {
  const ad = (id: number, extra: Partial<AdRow> = {}): AdRow => ({
    id,
    image_url: `https://x/${id}.png`,
    link_url: null,
    label: null,
    starts_on: null,
    ends_on: null,
    active: 1,
    ...extra,
  });
  it('หมุนวันละอัน', () => {
    const ads = [ad(1), ad(2)];
    const a = pickAd(ads, '2026-11-18')!.id;
    const b = pickAd(ads, '2026-11-19')!.id;
    expect(a).not.toBe(b);
  });
  it('ข้ามอันที่หมดเขต', () => {
    expect(pickAd([ad(1, { ends_on: '2026-11-17' }), ad(2)], '2026-11-18')!.id).toBe(2);
    expect(pickAd([ad(1, { starts_on: '2026-12-01' })], '2026-11-18')).toBeNull();
  });
});

describe('message', () => {
  it('เด้งเฉพาะคนที่ตั้งให้ @', () => {
    expect(allowedMentions(null)).toEqual({ parse: [] });
    expect(allowedMentions('<@&123>')).toEqual({ parse: [], roles: ['123'] });
    expect(allowedMentions('@everyone')).toEqual({ parse: ['everyone'] });
  });
  it('การ์ดมีแบนเนอร์ + ปุ่ม Donate/ติดต่อ', () => {
    const msg = buildReminderMessage(
      { title: 'ส่งรายงาน', message: 'ก่อน 17:00', days: WEEKDAYS, mention: '<@&9>', created_by: '1' },
      { hm: '13:00', round: 2, total: 3 },
      { id: 1, image_url: 'https://x/a.png', link_url: 'https://x', label: 'Kanopi', starts_on: null, ends_on: null, active: 1 },
      { donate_url: 'https://donate', contact_url: 'https://contact' },
    );
    expect(msg.flags).toBe(1 << 15);
    const json = JSON.stringify(msg);
    expect(json).toContain('https://x/a.png');
    expect(json).toContain('รอบ 2/3');
    expect(json).toContain('https://donate');
    expect(json).toContain('https://contact');
    expect(msg.components[0]).toEqual({ type: 10, content: '<@&9>' });
  });
});
