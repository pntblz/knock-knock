// ลงทะเบียนคำสั่ง slash กับ Discord
// รัน: npm run register   (อ่านค่าจาก .dev.vars)
import { OWNER_COMMAND, REMIND_COMMAND } from '../src/commands.ts';

const token = process.env.DISCORD_TOKEN;
const appId = process.env.DISCORD_APPLICATION_ID;
const ownerGuild = process.env.OWNER_GUILD_ID;
if (!token || !appId) {
  console.error('ต้องตั้ง DISCORD_TOKEN และ DISCORD_APPLICATION_ID ใน .dev.vars');
  process.exit(1);
}

async function put(path: string, body: unknown) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const data = (await res.json()) as { name: string }[];
  return data.map((c) => c.name).join(', ');
}

// /remind ใช้ได้ทุกเซิร์ฟที่เชิญบอท
console.log('global:', await put(`/applications/${appId}/commands`, [REMIND_COMMAND]));

// /owner ลงเฉพาะเซิร์ฟของเจ้าของ
if (ownerGuild) {
  console.log(`guild ${ownerGuild}:`, await put(`/applications/${appId}/guilds/${ownerGuild}/commands`, [OWNER_COMMAND]));
} else {
  console.log('ข้าม /owner — ยังไม่ได้ตั้ง OWNER_GUILD_ID');
}
