// ทำงานทุกนาทีจาก Cron Trigger: หาแจ้งเตือนที่ถึงเวลาแล้วส่ง
import { DiscordError, sendChannelMessage, type Env } from './discord';
import { loadAds, loadSettings, type ReminderRow } from './db';
import { buildReminderMessage } from './message';
import { dueSlots, pickAd, sqliteUtcToMs, type DueSlot } from './schedule';

// Workers Free ยิง fetch ได้ ~50 ครั้งต่อรอบ — เผื่อไว้ ที่เหลือส่งรอบถัดไป (ย้อนดูได้ 5 นาที)
const MAX_SENDS_PER_TICK = 40;

export async function runTick(env: Env, now = new Date()): Promise<{ sent: number; failed: number; deferred: number }> {
  const { results } = await env.DB.prepare(
    `SELECT r.*, COALESCE(g.timezone, 'Asia/Bangkok') AS tz
       FROM reminders r LEFT JOIN guilds g ON g.guild_id = r.guild_id
      WHERE r.active = 1`,
  ).all<ReminderRow & { tz: string }>();

  const due: { r: ReminderRow; s: DueSlot }[] = [];
  for (const r of results) {
    let times: string[];
    try {
      times = JSON.parse(r.times);
    } catch {
      continue;
    }
    for (const s of dueSlots({ times, days: r.days, createdAtMs: sqliteUtcToMs(r.created_at) }, now, r.tz)) {
      due.push({ r, s });
    }
  }

  // ล้างประวัติเก่าวันละครั้ง
  if (now.getUTCHours() === 0 && now.getUTCMinutes() === 0) {
    await env.DB.prepare("DELETE FROM sends WHERE sent_at < datetime('now', '-3 days')").run();
  }

  if (!due.length) return { sent: 0, failed: 0, deferred: 0 };

  due.sort((a, b) => a.s.slot.localeCompare(b.s.slot)); // รอบที่ค้างนานสุดก่อน
  const [settings, ads] = await Promise.all([loadSettings(env.DB), loadAds(env.DB)]);

  let sent = 0;
  let failed = 0;
  let attempts = 0;
  for (const { r, s } of due) {
    if (attempts >= MAX_SENDS_PER_TICK) break;
    // จองรอบนี้ก่อนส่ง — ถ้ามีอีกตัวจองไปแล้ว (cron ซ้อน/ย้อนดู) จะไม่ส่งซ้ำ
    const claim = await env.DB.prepare('INSERT OR IGNORE INTO sends (reminder_id, slot) VALUES (?, ?)')
      .bind(r.id, s.slot)
      .run();
    if (!claim.meta.changes) continue;

    attempts++;
    const ad = pickAd(ads, s.slot.slice(0, 10));
    try {
      await sendChannelMessage(env, r.channel_id, buildReminderMessage(r, s, ad, settings));
      sent++;
      if (r.last_error) await env.DB.prepare('UPDATE reminders SET last_error = NULL WHERE id = ?').bind(r.id).run();
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      // ห้องถูกลบ / บอทไม่มีสิทธิ์ส่ง = ส่งต่อไปก็พังทุกรอบ → พักไว้ให้แอดมินแก้
      const stop = e instanceof DiscordError && (e.status === 403 || e.status === 404);
      await env.DB.batch([
        env.DB.prepare('UPDATE sends SET ok = 0 WHERE reminder_id = ? AND slot = ?').bind(r.id, s.slot),
        env.DB.prepare(`UPDATE reminders SET last_error = ?${stop ? ', active = 0' : ''} WHERE id = ?`).bind(
          msg.slice(0, 500),
          r.id,
        ),
      ]);
    }
  }
  return { sent, failed, deferred: due.length - attempts };
}
