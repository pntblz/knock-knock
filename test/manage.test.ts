import { describe, expect, it } from 'vitest';
import { canManage, dayChoices, daysInput, editModal, idChoices, readEditOptions, readModal } from '../src/manage';
import { parseDays, WEEKDAYS, WEEKEND, ALL_DAYS } from '../src/schedule';
import { buildReminderMessage, topLine } from '../src/message';
import type { ReminderRow } from '../src/db';
import { isGuildAllowed, type Env } from '../src/discord';

const row: ReminderRow = {
  id: 3,
  guild_id: 'g',
  channel_id: 'c',
  title: 'Khui AI',
  message: 'ล็อคอิน Khui AI',
  times: '["17:15","17:30"]',
  days: ALL_DAYS,
  mention: null,
  created_by: 'u1',
  active: 1,
  last_error: null,
  created_at: '2026-11-19 00:00:00',
  call_text: null,
};

describe('manage', () => {
  it('canManage: เฉพาะ Administrator / Manage Server (คนตั้งเองแต่ไม่มีสิทธิ์ = ไม่ได้)', () => {
    expect(canManage('0')).toBe(false);
    expect(canManage(String(1 << 5))).toBe(true);
    expect(canManage(String(1 << 3))).toBe(true);
    expect(canManage('2048')).toBe(false);
    expect(canManage(undefined)).toBe(false);
  });

  it('isGuildAllowed: ตั้งรายชื่อแล้วรับเฉพาะในรายชื่อ · ไม่ตั้ง = ทุกเซิร์ฟ', () => {
    const env = { ALLOWED_GUILD_IDS: ' 111, 222 ' } as Env;
    expect(isGuildAllowed(env, '111')).toBe(true);
    expect(isGuildAllowed(env, '333')).toBe(false);
    expect(isGuildAllowed({} as Env, '333')).toBe(true);
  });

  it('daysInput พิมพ์กลับเข้า parseDays ได้ค่าเดิม', () => {
    for (const m of [ALL_DAYS, WEEKDAYS, WEEKEND, (1 << 1) | (1 << 4), 1 << 0]) {
      expect(parseDays(daysInput(m))).toBe(m);
    }
  });

  it('ฟอร์มเติมค่าเดิม แล้วอ่านกลับได้', () => {
    const modal = editModal(row) as { data: { components: { components: { custom_id: string; value: string }[] }[] } };
    const f = readModal(modal.data.components);
    expect(f).toEqual({ title: 'Khui AI', message: 'ล็อคอิน Khui AI', times: ['17:15', '17:30'], days: ALL_DAYS, call_text: null });
  });

  it('/remind edit แก้เฉพาะช่องที่กรอก', () => {
    expect(readEditOptions({ id: 3 })).toEqual({});
    expect(readEditOptions({ id: 3, times: '18:00' })).toEqual({ times: ['18:00'] });
    expect(readEditOptions({ id: 3, days: 'จ-ศ', title: 'ใหม่' })).toEqual({ days: WEEKDAYS, title: 'ใหม่' });
  });

  it('idChoices ค้นจากชื่อหรือเลข', () => {
    const rows = [row, { ...row, id: 12, title: 'ส่งรายงาน' }];
    expect(idChoices(rows, '').map((c) => c.value)).toEqual(['3', '12']);
    expect(idChoices(rows, 'รายงาน').map((c) => c.value)).toEqual(['12']);
    expect(idChoices(rows, '#3').map((c) => c.value)).toEqual(['3']);
    expect(idChoices(rows, '')[0].name).toContain('#3 Khui AI');
  });
});

describe('dropdown วันที่ซ้ำ', () => {
  it('ฟอร์มติ๊กวันตามค่าเดิม และอ่านค่าที่เลือกกลับเป็น bitmask', () => {
    const modal = editModal({ ...row, days: WEEKDAYS }) as {
      data: { components: { component: { custom_id: string; options?: { value: string; default: boolean }[] } }[] };
    };
    const sel = modal.data.components.find((c) => c.component.custom_id === 'days')!.component;
    expect(sel.options!.filter((o) => o.default).map((o) => o.value)).toEqual(['1', '2', '3', '4', '5']);
    const f = readModal([
      { component: { custom_id: 'title', value: 'x' } },
      { component: { custom_id: 'times', value: '09:00' } },
      { component: { custom_id: 'days', values: ['6', '0'] } },
    ]);
    expect(f.days).toBe(WEEKEND);
  });
  it('dayChoices: ว่าง = ตัวเลือกสำเร็จรูป · พิมพ์ถูก = ขึ้นเป็นอันแรก · พิมพ์ผิด = ไม่เสนอค่าผิด', () => {
    expect(dayChoices('')[0].value).toBe('ทุกวัน');
    expect(dayChoices('จ,พฤ')[0]).toEqual({ name: '✅ จ. พฤ. (ที่พิมพ์)', value: 'จ,พฤ' });
    expect(dayChoices('xyz').every((c) => !c.name.includes('ที่พิมพ์'))).toBe(true);
  });
});

describe('บรรทัดเรียกตั้งเองได้', () => {
  it('ว่าง = อัตโนมัติ · ตั้งเอง = ใช้ตามที่ตั้ง', () => {
    expect(topLine(row)).toBe('🔔 อย่าลืมล็อคอิน Khui AI น้า ⋆. 𐙚 ˚');
    expect(topLine({ ...row, call_text: 'ตื่นได้แล้ว~ ♡' })).toBe('ตื่นได้แล้ว~ ♡');
  });
  it('การ์ด: แท็กนำหน้าเสมอ · ไม่มีแท็กแต่ตั้งเองก็ยังโชว์', () => {
    const slot = { hm: '09:00', round: 1, total: 1 };
    const withTag = buildReminderMessage({ ...row, mention: '<@&9>', call_text: 'ตื่น~' }, slot, null, {});
    expect(withTag.components[0]).toEqual({ type: 10, content: '<@&9> ตื่น~' });
    const noTag = buildReminderMessage({ ...row, call_text: 'ตื่น~' }, slot, null, {});
    expect(noTag.components[0]).toEqual({ type: 10, content: 'ตื่น~' });
    const plain = buildReminderMessage(row, slot, null, {});
    expect((plain.components[0] as { type: number }).type).toBe(17);
  });
  it('/remind edit call: "-" = กลับเป็นอัตโนมัติ', () => {
    expect(readEditOptions({ id: '3', call: 'ตื่น~' })).toEqual({ call_text: 'ตื่น~' });
    expect(readEditOptions({ id: '3', call: '-' })).toEqual({ call_text: null });
  });
  it('ฟอร์ม: ช่องบรรทัดเรียกว่าง = null', () => {
    const f = readModal([
      { component: { custom_id: 'title', value: 'x' } },
      { component: { custom_id: 'call', value: '' } },
      { component: { custom_id: 'times', value: '09:00' } },
      { component: { custom_id: 'days', values: ['1'] } },
    ]);
    expect(f.call_text).toBeNull();
  });
});
