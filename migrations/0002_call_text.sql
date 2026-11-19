-- บรรทัดเรียกเหนือการ์ด ("อย่าลืม… น้า") ที่ตั้งเองได้ต่อแจ้งเตือน · ว่าง = ใช้แบบอัตโนมัติ
ALTER TABLE reminders ADD COLUMN call_text TEXT;
