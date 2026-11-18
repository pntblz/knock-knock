-- ตั้งค่าต่อเซิร์ฟเวอร์
CREATE TABLE guilds (
  guild_id   TEXT PRIMARY KEY,
  timezone   TEXT NOT NULL DEFAULT 'Asia/Bangkok'
);

-- แจ้งเตือน
CREATE TABLE reminders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  title       TEXT NOT NULL,
  message     TEXT,
  times       TEXT NOT NULL,          -- JSON ["09:00","13:00"]
  days        INTEGER NOT NULL,       -- bitmask: bit0 = อาทิตย์ … bit6 = เสาร์
  mention     TEXT,                   -- "<@123>" / "<@&456>" / "@everyone"
  created_by  TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  last_error  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX reminders_guild ON reminders (guild_id);
CREATE INDEX reminders_active ON reminders (active);

-- รอบที่ส่งแล้ว กันส่งซ้ำ (slot = "2026-11-18 09:00" ตามเวลาของเซิร์ฟ)
CREATE TABLE sends (
  reminder_id INTEGER NOT NULL,
  slot        TEXT NOT NULL,
  sent_at     TEXT NOT NULL DEFAULT (datetime('now')),
  ok          INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (reminder_id, slot)
);

-- แบนเนอร์โฆษณา (เจ้าของบอทเป็นคนจัดการ)
CREATE TABLE ads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  image_url  TEXT NOT NULL,
  link_url   TEXT,
  label      TEXT,
  starts_on  TEXT,                    -- YYYY-MM-DD (ว่าง = เริ่มทันที)
  ends_on    TEXT,                    -- YYYY-MM-DD (ว่าง = ไม่มีวันจบ)
  active     INTEGER NOT NULL DEFAULT 1
);

-- ค่าตั้งรวมของบอท: donate_url, contact_url, accent_color
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
