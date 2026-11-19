// นิยามคำสั่ง slash — ใช้ทั้งตอนลงทะเบียน (scripts/register-commands.ts) และอ้างชื่อในตัวจัดการ
// ไฟล์นี้ห้าม import อะไร (สคริปต์ลงทะเบียนรันด้วย node ตรง ๆ)

const STRING = 3;
const INTEGER = 4;
const CHANNEL = 7;
const SUB = 1;

const MANAGE_GUILD = String(1 << 5);
const GUILD_ONLY = [0]; // ใช้ได้เฉพาะในเซิร์ฟเวอร์

const idOption = { type: INTEGER, name: 'id', description: 'เลขแจ้งเตือน (ดูจาก /remind list)', required: true, min_value: 1 };

export const REMIND_COMMAND = {
  name: 'remind',
  description: 'ตั้งแจ้งเตือนประจำวันในห้องนี้',
  default_member_permissions: MANAGE_GUILD,
  contexts: GUILD_ONLY,
  options: [
    {
      type: SUB,
      name: 'add',
      description: 'เพิ่มแจ้งเตือน',
      options: [
        { type: STRING, name: 'title', description: 'เรื่องที่จะเตือน', required: true, max_length: 100 },
        { type: STRING, name: 'times', description: 'เวลา คั่นด้วยจุลภาค เช่น 09:00,13:00,17:00' },
        { type: STRING, name: 'start', description: 'หรือ: เวลาเริ่ม เช่น 08:00 (ใช้คู่กับ every + rounds)' },
        { type: INTEGER, name: 'every', description: 'ทุกกี่นาที เช่น 120 = ทุก 2 ชม.', min_value: 1, max_value: 1440 },
        { type: INTEGER, name: 'rounds', description: 'กี่รอบต่อวัน', min_value: 1, max_value: 24 },
        { type: STRING, name: 'days', description: 'วันที่ซ้ำ: ทุกวัน · จ-ศ · ส-อา · จ,พ,ศ (ค่าเริ่มต้น ทุกวัน)' },
        { type: STRING, name: 'message', description: 'ข้อความในกล่อง', max_length: 1500 },
        { type: CHANNEL, name: 'channel', description: 'ห้องที่จะส่ง (ค่าเริ่มต้น ห้องนี้)', channel_types: [0, 5] },
        { type: STRING, name: 'tag', description: 'แท็กคน/ยศ พิมพ์ @ แล้วเลือกได้หลายอัน เช่น @ทีมงาน @ยูมี่ หรือ @everyone' },
      ],
    },
    {
      type: SUB,
      name: 'tag',
      description: 'เปลี่ยนคน/ยศที่แท็กของแจ้งเตือน',
      options: [idOption, { type: STRING, name: 'tag', description: 'พิมพ์ @ แล้วเลือกได้หลายอัน (เว้นว่าง = ไม่แท็กใคร)' }],
    },
    {
      type: SUB,
      name: 'panel',
      description: 'ส่งแผงปุ่ม "รับแจ้งเตือน" ให้คนกดรับยศที่แจ้งเตือนนี้แท็กเอง',
      options: [
        idOption,
        { type: CHANNEL, name: 'channel', description: 'ห้องที่จะวางแผง (ค่าเริ่มต้น ห้องนี้)', channel_types: [0, 5] },
      ],
    },
    { type: SUB, name: 'help', description: 'วิธีใช้และคำสั่งทั้งหมด' },
    { type: SUB, name: 'list', description: 'ดูแจ้งเตือนทั้งหมดของเซิร์ฟนี้' },
    { type: SUB, name: 'remove', description: 'ลบแจ้งเตือน', options: [idOption] },
    { type: SUB, name: 'pause', description: 'พักแจ้งเตือน', options: [idOption] },
    { type: SUB, name: 'resume', description: 'เปิดแจ้งเตือนต่อ', options: [idOption] },
    { type: SUB, name: 'test', description: 'ส่งแจ้งเตือนนี้ไปที่ห้องทันที 1 ครั้ง', options: [idOption] },
    {
      type: SUB,
      name: 'timezone',
      description: 'ตั้งเขตเวลาของเซิร์ฟ (ค่าเริ่มต้น Asia/Bangkok)',
      options: [{ type: STRING, name: 'zone', description: 'เช่น Asia/Bangkok, Asia/Tokyo', required: true }],
    },
  ],
};

export const OWNER_COMMAND = {
  name: 'owner',
  description: 'ตั้งค่าของเจ้าของบอท (แบนเนอร์ · Donate · ติดต่อ)',
  default_member_permissions: '0', // ซ่อนจากทุกคนยกเว้นแอดมินเซิร์ฟ — และตรวจ OWNER_IDS ซ้ำอีกชั้น
  contexts: GUILD_ONLY,
  options: [
    {
      type: SUB,
      name: 'ad-add',
      description: 'เพิ่มแบนเนอร์โฆษณา',
      options: [
        { type: STRING, name: 'image', description: 'ลิงก์รูป/GIF (https://…)', required: true },
        { type: STRING, name: 'link', description: 'ลิงก์เมื่อกดปุ่มโฆษณา' },
        { type: STRING, name: 'label', description: 'ชื่อผู้สนับสนุน / ข้อความปุ่ม', max_length: 80 },
        { type: STRING, name: 'start', description: 'วันเริ่ม YYYY-MM-DD' },
        { type: STRING, name: 'end', description: 'วันจบ YYYY-MM-DD' },
      ],
    },
    { type: SUB, name: 'ad-list', description: 'ดูแบนเนอร์ทั้งหมด' },
    {
      type: SUB,
      name: 'ad-remove',
      description: 'ลบแบนเนอร์',
      options: [{ type: INTEGER, name: 'id', description: 'เลขแบนเนอร์', required: true, min_value: 1 }],
    },
    {
      type: SUB,
      name: 'set',
      description: 'ตั้งลิงก์ Donate / ติดต่อ / สีการ์ด',
      options: [
        {
          type: STRING,
          name: 'key',
          description: 'ค่าที่จะตั้ง',
          required: true,
          choices: [
            { name: 'ลิงก์ Donate', value: 'donate_url' },
            { name: 'ลิงก์ติดต่อ', value: 'contact_url' },
            { name: 'สีขอบการ์ด (#9b6bd6)', value: 'accent_color' },
          ],
        },
        { type: STRING, name: 'value', description: 'ค่าใหม่ (เว้นว่าง = ลบ)' },
      ],
    },
    { type: SUB, name: 'preview', description: 'ดูตัวอย่างการ์ดแจ้งเตือน (เห็นคนเดียว)' },
  ],
};
