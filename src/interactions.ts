// จัดการคำสั่ง slash ที่ Discord ส่งมา
import { guildTimezone, loadAds, loadSettings, type ReminderRow } from './db';
import { sendChannelMessage, type Env } from './discord';
import { buildReminderMessage, EPHEMERAL, IS_COMPONENTS_V2 } from './message';
import {
  buildTimes,
  formatDays,
  InputError,
  isValidTimezone,
  localParts,
  parseDays,
  parseTimes,
  pickAd,
  type AdRow,
} from './schedule';

const PING = 1;
const APPLICATION_COMMAND = 2;
const PONG = 1;
const REPLY = 4;

const MAX_REMINDERS_PER_GUILD = 25;

interface Option {
  name: string;
  type: number;
  value?: string | number;
  options?: Option[];
}

interface Interaction {
  type: number;
  guild_id?: string;
  channel_id?: string;
  member?: { user: { id: string } };
  user?: { id: string };
  data?: {
    name: string;
    options?: Option[];
    resolved?: { roles?: Record<string, unknown>; users?: Record<string, unknown> };
  };
}

type Json = Record<string, unknown>;

const reply = (content: string): Json => ({
  type: REPLY,
  data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } },
});

class UserError extends Error {}

export async function handleInteraction(env: Env, i: Interaction): Promise<Json> {
  if (i.type === PING) return { type: PONG };
  if (i.type !== APPLICATION_COMMAND || !i.data) return reply('ไม่รองรับคำสั่งนี้');

  const sub = i.data.options?.[0];
  if (!sub) return reply('ไม่พบคำสั่งย่อย');
  const opts: Record<string, string | number | undefined> = {};
  for (const o of sub.options ?? []) opts[o.name] = o.value;

  try {
    if (i.data.name === 'remind') return await remind(env, i, sub.name, opts);
    if (i.data.name === 'owner') return await owner(env, i, sub.name, opts);
    return reply('ไม่รู้จักคำสั่งนี้');
  } catch (e) {
    if (e instanceof UserError || e instanceof InputError) return reply(`⚠️ ${e.message}`);
    console.error('interaction failed', e);
    return reply('⚠️ มีบางอย่างผิดพลาด ลองใหม่อีกครั้ง');
  }
}

const userId = (i: Interaction) => i.member?.user.id ?? i.user?.id ?? '';
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

async function getReminder(env: Env, guildId: string, id: unknown): Promise<ReminderRow> {
  const row = await env.DB.prepare('SELECT * FROM reminders WHERE id = ? AND guild_id = ?')
    .bind(Number(id), guildId)
    .first<ReminderRow>();
  if (!row) throw new UserError(`ไม่พบแจ้งเตือน #${id} ในเซิร์ฟนี้`);
  return row;
}

function resolveMention(i: Interaction, id: unknown): string | null {
  if (typeof id !== 'string' || !id) return null;
  if (id === i.guild_id) return '@everyone'; // role @everyone มี id เท่ากับเซิร์ฟ
  if (i.data?.resolved?.roles?.[id]) return `<@&${id}>`;
  return `<@${id}>`;
}

async function remind(env: Env, i: Interaction, sub: string, o: Record<string, string | number | undefined>): Promise<Json> {
  const guildId = i.guild_id;
  if (!guildId) throw new UserError('ใช้ได้ในเซิร์ฟเวอร์เท่านั้น');

  switch (sub) {
    case 'add': {
      const title = str(o.title);
      if (!title) throw new UserError('ต้องใส่เรื่อง');

      let times: string[];
      if (str(o.times)) {
        times = parseTimes(str(o.times));
      } else if (str(o.start)) {
        const rounds = Number(o.rounds ?? 1);
        times = buildTimes(str(o.start), Number(o.every ?? 0), rounds);
      } else {
        throw new UserError('ต้องใส่ `times` (เช่น 09:00,13:00) หรือ `start` + `every` + `rounds`');
      }
      const days = parseDays(str(o.days));
      const channelId = str(o.channel) || i.channel_id;
      if (!channelId) throw new UserError('ไม่พบห้องที่จะส่ง');

      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM reminders WHERE guild_id = ?')
        .bind(guildId)
        .first<{ n: number }>();
      if ((count?.n ?? 0) >= MAX_REMINDERS_PER_GUILD) {
        throw new UserError(`เซิร์ฟนี้ตั้งได้สูงสุด ${MAX_REMINDERS_PER_GUILD} รายการ ลบอันเก่าก่อนนะ`);
      }

      const mention = resolveMention(i, o.mention);
      const res = await env.DB.batch([
        env.DB.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').bind(guildId),
        env.DB.prepare(
          `INSERT INTO reminders (guild_id, channel_id, title, message, times, days, mention, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        ).bind(guildId, channelId, title, str(o.message) || null, JSON.stringify(times), days, mention, userId(i)),
      ]);
      const id = (res[1].results[0] as { id: number }).id;
      const tz = await guildTimezone(env.DB, guildId);
      return reply(
        [
          `✅ ตั้งแจ้งเตือน **#${id} ${title}** แล้ว`,
          `⏰ ${times.join(', ')} (${times.length} รอบ/วัน · ${tz})`,
          `📅 ${formatDays(days)} · ส่งที่ <#${channelId}>${mention ? ` · @ ${mention}` : ''}`,
          `-# ลอง \`/remind test id:${id}\` เพื่อเช็กว่าบอทส่งในห้องนั้นได้`,
        ].join('\n'),
      );
    }

    case 'list': {
      const { results } = await env.DB.prepare('SELECT * FROM reminders WHERE guild_id = ? ORDER BY id')
        .bind(guildId)
        .all<ReminderRow>();
      if (!results.length) return reply('ยังไม่มีแจ้งเตือน — เพิ่มด้วย `/remind add`');
      const tz = await guildTimezone(env.DB, guildId);
      const lines = results.map((r) => {
        const state = r.active ? '🟢' : '⏸️';
        const err = r.last_error ? `\n   ⚠️ ${r.last_error.slice(0, 120)}` : '';
        return `${state} **#${r.id} ${r.title}** · ${JSON.parse(r.times).join(', ')} · ${formatDays(r.days)} · <#${r.channel_id}>${err}`;
      });
      return reply(clipLines([`เขตเวลา: ${tz}`, ...lines]));
    }

    case 'remove': {
      const r = await getReminder(env, guildId, o.id);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM reminders WHERE id = ?').bind(r.id),
        env.DB.prepare('DELETE FROM sends WHERE reminder_id = ?').bind(r.id),
      ]);
      return reply(`🗑️ ลบ #${r.id} ${r.title} แล้ว`);
    }

    case 'pause':
    case 'resume': {
      const r = await getReminder(env, guildId, o.id);
      const on = sub === 'resume';
      await env.DB.prepare('UPDATE reminders SET active = ?, last_error = CASE WHEN ? THEN NULL ELSE last_error END WHERE id = ?')
        .bind(on ? 1 : 0, on ? 1 : 0, r.id)
        .run();
      return reply(on ? `▶️ เปิด #${r.id} ${r.title} ต่อแล้ว` : `⏸️ พัก #${r.id} ${r.title} แล้ว`);
    }

    case 'test': {
      const r = await getReminder(env, guildId, o.id);
      const tz = await guildTimezone(env.DB, guildId);
      const now = localParts(new Date(), tz);
      const [settings, ads] = await Promise.all([loadSettings(env.DB), loadAds(env.DB)]);
      const times: string[] = JSON.parse(r.times);
      try {
        await sendChannelMessage(
          env,
          r.channel_id,
          buildReminderMessage(r, { hm: now.hm, round: 1, total: times.length }, pickAd(ads, now.date), settings),
        );
      } catch (e) {
        throw new UserError(`ส่งไม่ได้ — ให้สิทธิ์บอท "View Channel" + "Send Messages" ใน <#${r.channel_id}> ก่อน\n-# ${String(e).slice(0, 200)}`);
      }
      return reply(`📨 ส่งตัวอย่างไปที่ <#${r.channel_id}> แล้ว`);
    }

    case 'timezone': {
      const zone = str(o.zone);
      if (!isValidTimezone(zone)) throw new UserError(`ไม่รู้จักเขตเวลา "${zone}" (ตัวอย่าง Asia/Bangkok)`);
      await env.DB.prepare(
        'INSERT INTO guilds (guild_id, timezone) VALUES (?, ?) ON CONFLICT (guild_id) DO UPDATE SET timezone = excluded.timezone',
      )
        .bind(guildId, zone)
        .run();
      return reply(`🌏 ตั้งเขตเวลาเป็น **${zone}** แล้ว (ตอนนี้ ${localParts(new Date(), zone).hm})`);
    }
  }
  return reply('ไม่รู้จักคำสั่งย่อย');
}

function isOwner(env: Env, id: string): boolean {
  return (env.OWNER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(id);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const URL_RE = /^https?:\/\/\S+$/i;

async function owner(env: Env, i: Interaction, sub: string, o: Record<string, string | number | undefined>): Promise<Json> {
  if (!isOwner(env, userId(i))) throw new UserError('คำสั่งนี้สำหรับเจ้าของบอทเท่านั้น');

  switch (sub) {
    case 'ad-add': {
      const image = str(o.image);
      const link = str(o.link) || null;
      const start = str(o.start) || null;
      const end = str(o.end) || null;
      if (!URL_RE.test(image)) throw new UserError('ลิงก์รูปต้องขึ้นต้นด้วย https://');
      if (link && !URL_RE.test(link)) throw new UserError('ลิงก์โฆษณาต้องขึ้นต้นด้วย https://');
      for (const d of [start, end]) if (d && !DATE_RE.test(d)) throw new UserError(`วันที่ "${d}" ต้องเป็น YYYY-MM-DD`);
      const row = await env.DB.prepare(
        'INSERT INTO ads (image_url, link_url, label, starts_on, ends_on) VALUES (?, ?, ?, ?, ?) RETURNING id',
      )
        .bind(image, link, str(o.label) || null, start, end)
        .first<{ id: number }>();
      return reply(`🖼️ เพิ่มแบนเนอร์ #${row?.id} แล้ว — ใช้ \`/owner preview\` ดูหน้าตา`);
    }

    case 'ad-list': {
      const { results } = await env.DB.prepare('SELECT * FROM ads WHERE active = 1 ORDER BY id').all<AdRow>();
      if (!results.length) return reply('ยังไม่มีแบนเนอร์');
      const today = localParts(new Date(), 'Asia/Bangkok').date;
      const todays = pickAd(results, today);
      return reply(
        clipLines(
          results.map(
            (a) =>
              `${a.id === todays?.id ? '⭐' : '•'} **#${a.id}** ${a.label ?? ''} · ${a.starts_on ?? '…'} → ${a.ends_on ?? '…'}\n   ${a.image_url}`,
          ),
        ) + '\n-# ⭐ = แบนเนอร์ของวันนี้',
      );
    }

    case 'ad-remove': {
      const res = await env.DB.prepare('UPDATE ads SET active = 0 WHERE id = ? AND active = 1').bind(Number(o.id)).run();
      return reply(res.meta.changes ? `🗑️ ลบแบนเนอร์ #${o.id} แล้ว` : `ไม่พบแบนเนอร์ #${o.id}`);
    }

    case 'set': {
      const key = str(o.key);
      const value = str(o.value);
      if (!['donate_url', 'contact_url', 'accent_color'].includes(key)) throw new UserError('ไม่รู้จักค่านี้');
      if (!value) {
        await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(key).run();
        return reply(`ลบ ${key} แล้ว`);
      }
      if (key.endsWith('_url') && !URL_RE.test(value)) throw new UserError('ลิงก์ต้องขึ้นต้นด้วย https://');
      if (key === 'accent_color' && !/^#?[0-9a-f]{6}$/i.test(value)) throw new UserError('สีต้องเป็นรูปแบบ #e91e63');
      await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
        .bind(key, value)
        .run();
      return reply(`✅ ตั้ง ${key} = ${value}`);
    }

    case 'preview': {
      const [settings, ads] = await Promise.all([loadSettings(env.DB), loadAds(env.DB)]);
      const now = localParts(new Date(), 'Asia/Bangkok');
      const msg = buildReminderMessage(
        { title: 'ตัวอย่างแจ้งเตือน', message: 'อย่าลืมส่งรายงานก่อน 17:00 นะ', days: 0b0111110, mention: null, created_by: userId(i) },
        { hm: now.hm, round: 2, total: 3 },
        pickAd(ads, now.date),
        settings,
      );
      return { type: REPLY, data: { ...msg, flags: IS_COMPONENTS_V2 | EPHEMERAL } };
    }
  }
  return reply('ไม่รู้จักคำสั่งย่อย');
}

/** ข้อความตอบกลับยาวได้ไม่เกิน 2000 ตัว */
function clipLines(lines: string[]): string {
  let out = '';
  for (const l of lines) {
    if (out.length + l.length + 1 > 1900) return out + '\n…';
    out += (out ? '\n' : '') + l;
  }
  return out;
}
