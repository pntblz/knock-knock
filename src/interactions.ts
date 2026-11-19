// จัดการคำสั่ง slash ที่ Discord ส่งมา
import { guildTimezone, loadAds, loadSettings, type ReminderRow } from './db';
import { DiscordError, isGuildAllowed, leaveGuild, sendChannelMessage, setMemberRole, type Env } from './discord';
import {
  applyEdit,
  canManage,
  dayChoices,
  type ModalRow,
  DEL_NO,
  DEL_PREFIX,
  DEL_YES_PREFIX,
  deleteCancelled,
  deleteConfirm,
  deleteReminder,
  EDIT_MODAL_PREFIX,
  EDIT_PREFIX,
  editedReply,
  editModal,
  idChoices,
  readEditOptions,
  readModal,
} from './manage';
import {
  buildHelpMessage,
  buildReminderMessage,
  EPHEMERAL,
  HELP_CUSTOM_ID,
  IS_COMPONENTS_V2,
  normalizeTags,
  ROLE_PREFIX,
  buildRolePanel,
  tagRoleIds,
} from './message';
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
const MESSAGE_COMPONENT = 3;
const AUTOCOMPLETE = 4;
const MODAL_SUBMIT = 5;
const AUTOCOMPLETE_RESULT = 8;
const PONG = 1;
const REPLY = 4;

const MAX_REMINDERS_PER_GUILD = 25;

interface Option {
  name: string;
  type: number;
  value?: string | number;
  focused?: boolean;
  options?: Option[];
}

interface Interaction {
  type: number;
  guild_id?: string;
  channel_id?: string;
  member?: { user: { id: string }; roles?: string[]; permissions?: string };
  user?: { id: string };
  data?: {
    name: string;
    custom_id?: string;
    options?: Option[];
    components?: ModalRow[];
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

  // บอทเปิดใช้เฉพาะเซิร์ฟที่อนุญาต — เซิร์ฟอื่นตอบปฏิเสธแล้วออกจากเซิร์ฟนั้น
  if (!isGuildAllowed(env, i.guild_id)) {
    if (i.type === AUTOCOMPLETE) return { type: AUTOCOMPLETE_RESULT, data: { choices: [] } };
    await leaveGuild(env, i.guild_id!);
    return reply('🔒 บอทนี้เปิดใช้เฉพาะบางเซิร์ฟ — สนใจใช้งานติดต่อ Discord : @luv4yumie');
  }

  // ช่อง id ใน /remind … → รายชื่อแจ้งเตือนให้เลือก
  if (i.type === AUTOCOMPLETE) {
    const focused = i.data?.options?.[0]?.options?.find((o) => o.focused);
    if (focused?.name === 'days') {
      return { type: AUTOCOMPLETE_RESULT, data: { choices: dayChoices(String(focused.value ?? '')) } };
    }
    const rows = i.guild_id
      ? (
          await env.DB.prepare('SELECT id, title, times, days, active FROM reminders WHERE guild_id = ? ORDER BY id')
            .bind(i.guild_id)
            .all<ReminderRow>()
        ).results
      : [];
    return { type: AUTOCOMPLETE_RESULT, data: { choices: idChoices(rows, String(focused?.value ?? '')) } };
  }

  try {
    // กดปุ่มบนการ์ด
    if (i.type === MESSAGE_COMPONENT) {
      const cid = i.data?.custom_id ?? '';
      if (cid === HELP_CUSTOM_ID) return await helpReply(env);
      if (cid.startsWith(ROLE_PREFIX)) return await toggleRole(env, i, cid.slice(ROLE_PREFIX.length));
      if (cid === DEL_NO) return deleteCancelled();
      if (cid.startsWith(EDIT_PREFIX)) return editModal(await managed(env, i, cid.slice(EDIT_PREFIX.length)));
      if (cid.startsWith(DEL_PREFIX)) return deleteConfirm(await managed(env, i, cid.slice(DEL_PREFIX.length)));
      if (cid.startsWith(DEL_YES_PREFIX)) return await deleteReminder(env, await managed(env, i, cid.slice(DEL_YES_PREFIX.length)));
      return reply('ปุ่มนี้ใช้ไม่ได้แล้ว');
    }

    // ส่งฟอร์มแก้ไข
    if (i.type === MODAL_SUBMIT) {
      const cid = i.data?.custom_id ?? '';
      if (!cid.startsWith(EDIT_MODAL_PREFIX)) return reply('ฟอร์มนี้ใช้ไม่ได้แล้ว');
      const r = await managed(env, i, cid.slice(EDIT_MODAL_PREFIX.length));
      return editedReply(await applyEdit(env, r, readModal(i.data?.components ?? [])));
    }
  } catch (e) {
    if (e instanceof UserError || e instanceof InputError) return reply(`⚠️ ${e.message}`);
    console.error('component failed', e);
    return reply('⚠️ มีบางอย่างผิดพลาด ลองใหม่อีกครั้ง');
  }

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
    .bind(Number(String(id ?? '').replace(/\D/g, '')), guildId)
    .first<ReminderRow>();
  if (!row) throw new UserError(`ไม่พบแจ้งเตือน #${id} ในเซิร์ฟนี้`);
  return row;
}

/** กดปุ่ม "รับ / ยกเลิกแจ้งเตือน" — มียศครบแล้ว = เอาออกทั้งหมด, ยังไม่ครบ = ให้ที่ขาด */
async function toggleRole(env: Env, i: Interaction, idText: string): Promise<Json> {
  if (!i.guild_id || !i.member) return reply('ใช้ได้ในเซิร์ฟเวอร์เท่านั้น');
  const r = await env.DB.prepare('SELECT * FROM reminders WHERE id = ? AND guild_id = ?')
    .bind(Number(idText), i.guild_id)
    .first<ReminderRow>();
  if (!r) return reply('แจ้งเตือนนี้ถูกลบไปแล้ว');
  const roles = tagRoleIds(r.mention);
  if (!roles.length) return reply('แจ้งเตือนนี้ไม่ได้แท็กยศแล้ว — ไม่มียศให้รับ');

  const have = new Set(i.member.roles ?? []);
  const add = roles.some((id) => !have.has(id));
  const targets = add ? roles.filter((id) => !have.has(id)) : roles;
  try {
    for (const roleId of targets) await setMemberRole(env, i.guild_id, i.member.user.id, roleId, add);
  } catch (e) {
    if (e instanceof DiscordError && e.status === 403) {
      return reply(
        '⚠️ บอทให้ยศไม่ได้ — แอดมินต้องให้สิทธิ์ **Manage Roles** กับบอท และลากยศของบอท (knock-knock) ' +
          `ให้อยู่**สูงกว่า** ${roles.map((id) => `<@&${id}>`).join(' ')} ใน Server Settings › Roles`,
      );
    }
    throw e;
  }
  const names = targets.map((id) => `<@&${id}>`).join(' ');
  return reply(
    add
      ? `✅ ได้รับยศ ${names} แล้ว — จะถูกแท็กเมื่อถึงเวลา **${r.title}** (${JSON.parse(r.times).join(', ')})`
      : `🔕 เอายศ ${names} ออกแล้ว — จะไม่ถูกแท็กใน **${r.title}** อีก`,
  );
}

/** หาแจ้งเตือน + ตรวจว่าคนกดแก้/ลบได้ */
async function managed(env: Env, i: Interaction, idText: string): Promise<ReminderRow> {
  if (!i.guild_id) throw new UserError('ใช้ได้ในเซิร์ฟเวอร์เท่านั้น');
  const r = await env.DB.prepare('SELECT * FROM reminders WHERE id = ? AND guild_id = ?')
    .bind(Number(idText), i.guild_id)
    .first<ReminderRow>();
  if (!r) throw new UserError('แจ้งเตือนนี้ถูกลบไปแล้ว');
  if (!canManage(i.member?.permissions)) {
    throw new UserError('🔒 แก้/ลบได้เฉพาะผู้ดูแลเซิร์ฟ (สิทธิ์ Administrator หรือ Manage Server)');
  }
  return r;
}

async function helpReply(env: Env): Promise<Json> {
  return { type: REPLY, data: buildHelpMessage(await loadSettings(env.DB)) };
}

async function remind(env: Env, i: Interaction, sub: string, o: Record<string, string | number | undefined>): Promise<Json> {
  if (sub === 'help') return helpReply(env);
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

      const mention = normalizeTags(str(o.tag));
      const res = await env.DB.batch([
        env.DB.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').bind(guildId),
        env.DB.prepare(
          `INSERT INTO reminders (guild_id, channel_id, title, message, times, days, mention, created_by, call_text)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        ).bind(
          guildId,
          channelId,
          title,
          str(o.message) || null,
          JSON.stringify(times),
          days,
          mention,
          userId(i),
          str(o.call) || null,
        ),
      ]);
      const id = (res[1].results[0] as { id: number }).id;
      const tz = await guildTimezone(env.DB, guildId);
      return reply(
        [
          `✅ ตั้งแจ้งเตือน **#${id} ${title}** แล้ว`,
          `⏰ ${times.join(', ')} (${times.length} รอบ/วัน · ${tz})`,
          `📅 ${formatDays(days)} · ส่งที่ <#${channelId}>`,
          `🏷️ แท็ก: ${mention ?? 'ไม่แท็กใคร'}`,
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
        const tags = r.mention ? ` · 🏷️ ${r.mention}` : '';
        return `${state} **#${r.id} ${r.title}** · ${JSON.parse(r.times).join(', ')} · ${formatDays(r.days)} · <#${r.channel_id}>${tags}${err}`;
      });
      return reply(clipLines([`เขตเวลา: ${tz}`, ...lines]));
    }

    case 'edit': {
      const r = await getReminder(env, guildId, o.id);
      const f = readEditOptions(o);
      // ไม่กรอกอะไรนอกจาก id → เปิดฟอร์มแก้ไขที่เติมค่าเดิมไว้ให้
      if (!Object.keys(f).length) return editModal(r);
      return editedReply(await applyEdit(env, r, f));
    }

    case 'tag': {
      const r = await getReminder(env, guildId, o.id);
      const mention = normalizeTags(str(o.tag));
      await env.DB.prepare('UPDATE reminders SET mention = ? WHERE id = ?').bind(mention, r.id).run();
      return reply(`🏷️ #${r.id} ${r.title} — แท็ก: ${mention ?? 'ไม่แท็กใคร'}`);
    }

    case 'panel': {
      const r = await getReminder(env, guildId, o.id);
      if (!tagRoleIds(r.mention).length) {
        throw new UserError(`#${r.id} ยังไม่ได้แท็กยศ — ตั้งก่อนด้วย \`/remind tag id:${r.id} tag:@ยศ\``);
      }
      const channelId = str(o.channel) || i.channel_id;
      if (!channelId) throw new UserError('ไม่พบห้องที่จะส่ง');
      const settings = await loadSettings(env.DB);
      try {
        await sendChannelMessage(env, channelId, buildRolePanel({ ...r, times: JSON.parse(r.times) }, settings));
      } catch (e) {
        throw new UserError(`ส่งไม่ได้ — ให้สิทธิ์บอท "View Channel" + "Send Messages" ใน <#${channelId}> ก่อน\n-# ${String(e).slice(0, 200)}`);
      }
      return reply(`📌 ส่งแผงรับยศของ #${r.id} ไปที่ <#${channelId}> แล้ว — ปักหมุดไว้ให้คนเห็นได้เลย`);
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
      if (key === 'accent_color' && !/^#?[0-9a-f]{6}$/i.test(value)) throw new UserError('สีต้องเป็นรูปแบบ #9b6bd6');
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
