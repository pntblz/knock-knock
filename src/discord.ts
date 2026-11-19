// เรียก Discord REST API + ตรวจลายเซ็นของ interaction

const API = 'https://discord.com/api/v10';

export interface Env {
  DB: D1Database;
  DISCORD_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  OWNER_IDS?: string;
}

export class DiscordError extends Error {
  constructor(public status: number, public body: string) {
    super(`Discord ${status}: ${body.slice(0, 300)}`);
  }
}

export async function discordFetch(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const req = () =>
    fetch(API + path, {
      ...init,
      headers: {
        Authorization: `Bot ${env.DISCORD_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DiscordBot (https://github.com/pntblz/knock-knock, 0.1)',
        ...(init.headers ?? {}),
      },
    });
  let res = await req();
  if (res.status === 429) {
    // โดนจำกัดความถี่ — รอตามที่ Discord บอกแล้วลองอีกครั้งเดียว (ไม่เกิน 5 วิ)
    const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
    const wait = Math.min((body.retry_after ?? 1) * 1000, 5000);
    await new Promise((r) => setTimeout(r, wait));
    res = await req();
  }
  if (!res.ok) throw new DiscordError(res.status, await res.text());
  return res;
}

export async function sendChannelMessage(env: Env, channelId: string, body: unknown): Promise<void> {
  await discordFetch(env, `/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify(body) });
}

export async function setMemberRole(env: Env, guildId: string, userId: string, roleId: string, add: boolean) {
  await discordFetch(env, `/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
    method: add ? 'PUT' : 'DELETE',
    headers: { 'X-Audit-Log-Reason': encodeURIComponent(add ? 'กดรับแจ้งเตือน' : 'กดยกเลิกแจ้งเตือน') },
  });
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

let keyCache: { hex: string; key: CryptoKey } | null = null;

export async function verifyInteraction(env: Env, req: Request, body: string): Promise<boolean> {
  const sig = req.headers.get('X-Signature-Ed25519');
  const ts = req.headers.get('X-Signature-Timestamp');
  if (!sig || !ts || !/^[0-9a-f]+$/i.test(sig)) return false;
  if (!keyCache || keyCache.hex !== env.DISCORD_PUBLIC_KEY) {
    const key = await crypto.subtle.importKey('raw', hexToBytes(env.DISCORD_PUBLIC_KEY), { name: 'Ed25519' }, false, [
      'verify',
    ]);
    keyCache = { hex: env.DISCORD_PUBLIC_KEY, key };
  }
  return crypto.subtle.verify('Ed25519', keyCache.key, hexToBytes(sig), new TextEncoder().encode(ts + body));
}
