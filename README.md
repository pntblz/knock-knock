# knock-knock 🔔

บอท Discord ตั้งแจ้งเตือนประจำวัน: เรื่องอะไร กี่โมง กี่รอบต่อวัน ซ้ำวันไหน
ส่งเป็นการ์ดที่มีแบนเนอร์ (หมุนโฆษณาวันละอัน) + ปุ่ม Donate / ติดต่อ

รันบน **Cloudflare Workers + D1** แพลนฟรี ไม่ต้องเปิดเครื่องค้าง:
- Discord ส่งคำสั่ง `/remind` มาที่ URL ของ Worker (Interactions Endpoint)
- Cron ปลุก Worker ทุกนาทีเพื่อส่งแจ้งเตือนที่ถึงเวลา

## คำสั่ง

| คำสั่ง | ทำอะไร |
|---|---|
| `/remind add title times days message channel mention` | เพิ่มแจ้งเตือน · `times` = `09:00,13:00,17:00` |
| `/remind add title start every rounds …` | หรือตั้งแบบ เริ่ม 08:00 ทุก 120 นาที 4 รอบ |
| `/remind list` | ดูทั้งหมดของเซิร์ฟ (🟢 ทำงาน · ⏸️ พัก · ⚠️ ส่งไม่ได้) |
| `/remind pause` / `resume` / `remove` / `test` | พัก · เปิดต่อ · ลบ · ส่งทดสอบ 1 ครั้ง |
| `/remind timezone zone` | เขตเวลาของเซิร์ฟ (ค่าเริ่มต้น `Asia/Bangkok`) |
| `/owner ad-add` `ad-list` `ad-remove` | จัดการแบนเนอร์โฆษณา (เจ้าของบอทเท่านั้น) |
| `/owner set` | ตั้งลิงก์ Donate · ลิงก์ติดต่อ · สีการ์ด |
| `/owner preview` | ดูตัวอย่างการ์ด (เห็นคนเดียว) |

`days` รับ: `ทุกวัน` · `จ-ศ` · `ส-อา` · `จ,พ,ศ` · `mon,wed,fri`

`/remind` ใช้ได้เฉพาะคนที่มีสิทธิ์ **Manage Server** — แอดมินเปิดให้ role อื่นได้ที่
Server Settings › Integrations › knock-knock

ถ้าบอทส่งไม่ได้เพราะห้องถูกลบหรือไม่มีสิทธิ์ แจ้งเตือนนั้นจะพักเอง และขึ้นเหตุผลใน `/remind list`

## ติดตั้งครั้งแรก

1. **Discord** — https://discord.com/developers/applications › New Application
   - หน้า General Information: จด `Application ID` + `Public Key`
   - หน้า Bot: Reset Token แล้วจด token
   - หน้า Installation: เลือก Guild Install · scopes `bot` + `applications.commands` · สิทธิ์ `View Channels` + `Send Messages` + `Embed Links`
2. **ติดตั้งแพ็กเกจ + ล็อกอิน Cloudflare**
   ```bash
   npm install
   npx wrangler login
   ```
3. **สร้างฐานข้อมูล** แล้วเอา `database_id` ที่ได้ใส่ใน `wrangler.toml`
   ```bash
   npx wrangler d1 create knock-knock
   npm run db:migrate
   ```
4. **ใส่ค่าลับ** (ถามทีละค่า)
   ```bash
   npx wrangler secret put DISCORD_TOKEN
   npx wrangler secret put DISCORD_PUBLIC_KEY
   npx wrangler secret put DISCORD_APPLICATION_ID
   npx wrangler secret put OWNER_IDS
   ```
   `OWNER_IDS` = user id Discord ของคุณ (เปิด Developer Mode แล้วคลิกขวาที่ชื่อ › Copy User ID)
5. **Deploy** → ได้ URL เช่น `https://knock-knock.<ชื่อ>.workers.dev`
   ```bash
   npm run deploy
   ```
6. เอา URL นั้นไปใส่ **Interactions Endpoint URL** ในหน้า General Information ของ Discord แล้วกด Save
7. **ลงทะเบียนคำสั่ง** — คัดลอก `.dev.vars.example` เป็น `.dev.vars` เติมค่า แล้ว
   ```bash
   npm run register
   ```
8. เชิญบอทเข้าเซิร์ฟด้วยลิงก์ในหน้า Installation แล้วลอง `/remind add`

## พัฒนาต่อ

```bash
npm test          # เทสต์ตรรกะเวลา/วัน/การ์ด
npm run typecheck
```

## ข้อจำกัดแพลนฟรี

- ส่งได้ราว 40 ข้อความต่อนาที ที่เกินจะเลื่อนไปนาทีถัดไป (ย้อนส่งได้ไม่เกิน 5 นาที)
- เซิร์ฟละไม่เกิน 25 แจ้งเตือน · วันละไม่เกิน 24 รอบต่อแจ้งเตือน
- บอทไม่ขึ้นจุดเขียว "ออนไลน์" เพราะไม่ได้ต่อ gateway ค้าง แต่ใช้งานได้ปกติ
