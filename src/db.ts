import type { AdRow } from './schedule';
import type { BotSettings } from './message';

export interface ReminderRow {
  id: number;
  guild_id: string;
  channel_id: string;
  title: string;
  message: string | null;
  times: string; // JSON
  days: number;
  mention: string | null;
  created_by: string;
  active: number;
  last_error: string | null;
  created_at: string;
}

export async function loadSettings(db: D1Database): Promise<BotSettings> {
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  return Object.fromEntries(results.map((r) => [r.key, r.value])) as BotSettings;
}

export async function loadAds(db: D1Database): Promise<AdRow[]> {
  const { results } = await db.prepare('SELECT * FROM ads WHERE active = 1').all<AdRow>();
  return results;
}

export async function guildTimezone(db: D1Database, guildId: string): Promise<string> {
  const row = await db.prepare('SELECT timezone FROM guilds WHERE guild_id = ?').bind(guildId).first<{ timezone: string }>();
  return row?.timezone ?? 'Asia/Bangkok';
}
