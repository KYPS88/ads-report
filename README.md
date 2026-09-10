# Meta Ads Report Dashboard

แดชบอร์ดสรุปผลโฆษณา Meta (Facebook/Instagram) แบบหน้าเดียว — เปิดไฟล์ `index.html` ในเบราว์เซอร์ได้เลย ไม่ต้องติดตั้งอะไรเพิ่ม

## สิ่งที่แสดง

- **ตัวเลขสรุป (KPI)** — ยอดขาย, ค่าโฆษณา, ROAS, คนทักแชทใหม่, ออเดอร์ พร้อมเปอร์เซ็นต์เทียบช่วงก่อนหน้า
- **ยอดขาย เทียบ ค่าโฆษณา** — กราฟเส้นรายวัน (ชี้ที่กราฟเพื่อดูตัวเลขแต่ละวัน, กดดูเป็นตารางได้)
- **การส่งข้อความ** — จำนวนคนทักแชทใหม่ต่อวัน, ต้นทุนต่อข้อความ, อัตราปิดการขายจากแชท
- **ผลงานรายคอนเท้นต์** — ตารางเปรียบเทียบโฆษณา/โพสต์แต่ละชิ้น (เข้าถึง, คลิก, ทักแชท, ออเดอร์, ROAS) พร้อมกราฟสัดส่วนยอดขาย
- **ตัวกรองช่วงเวลา** — 7 / 30 / 90 วันล่าสุด มีผลกับทุกส่วนของหน้า

รองรับทั้งโหมดสว่างและโหมดมืดตามการตั้งค่าเครื่องผู้ใช้
ถ้ายังไม่ได้เชื่อมต่อข้อมูลจริง หน้าจะแสดง **ข้อมูลตัวอย่าง** (มีป้ายบอกชัดเจน)

## การต่อข้อมูลจริงจาก Meta Marketing API

### สิ่งที่ต้องมี

1. **Ad Account ID** — ดูได้จาก Ads Manager มุมซ้ายบน หรือใน URL (`act=1234567890`) → ใช้เป็น `act_1234567890`
2. **Access Token ที่มีสิทธิ์ `ads_read`** — สร้างได้ 2 ทาง:
   - ทางเร็ว (ทดลอง): [Graph API Explorer](https://developers.facebook.com/tools/explorer/) → เลือกแอปของคุณ → Add permission `ads_read` → Generate Access Token (token แบบนี้อายุสั้น ~1-2 ชั่วโมง ต่ออายุเป็น long-lived ได้ ~60 วัน)
   - ทางถาวร (แนะนำ): [Business Settings](https://business.facebook.com/settings) → Users → **System Users** → สร้าง system user → Assign บัญชีโฆษณา → Generate token สิทธิ์ `ads_read` (ไม่หมดอายุ)

### ทางที่ 1 — เชื่อมต่อในหน้าแดชบอร์ดเลย

เปิด `index.html` → กดปุ่ม **"เชื่อมต่อ Meta API"** → กรอก Ad Account ID กับ Access Token → **ดึงข้อมูล**

- ข้อมูลถูกดึงตรงจากเบราว์เซอร์ไปที่ `graph.facebook.com` เท่านั้น token เก็บใน localStorage ของเครื่องนั้น
- เหมาะกับใช้คนเดียว/ในทีมเล็ก **อย่า**โฮสต์หน้าที่กรอก token ไว้แล้วเป็นเว็บสาธารณะ
- หมายเหตุ: เปิดผ่าน claude.ai (artifact) จะเรียก API ไม่ได้เพราะถูกบล็อกด้าน security ให้เปิดไฟล์จากเครื่องหรือโฮสต์เอง

### ทางที่ 2 — สร้าง `data.json` ด้วยสคริปต์ (เหมาะกับการโฮสต์/รันตามรอบ)

```bash
META_AD_ACCOUNT_ID=act_1234567890 META_ACCESS_TOKEN=EAAB... node scripts/fetch-data.mjs
```

ได้ไฟล์ `data.json` ที่ root — หน้า `index.html` จะอ่านไฟล์นี้อัตโนมัติเมื่อเปิดผ่าน web server
(token อยู่แค่ฝั่งที่รันสคริปต์ ไม่ไปอยู่ในหน้าเว็บ) ตั้ง cron หรือ GitHub Actions รันซ้ำเพื่ออัปเดตข้อมูลได้

ต้องใช้ Node 18 ขึ้นไป และการเปิดแบบดับเบิลคลิกไฟล์ (`file://`) เบราว์เซอร์จะไม่ยอมอ่าน `data.json`
ให้รัน web server ง่ายๆ เช่น `npx serve` หรือ `python3 -m http.server` แล้วเปิด `http://localhost:8000`

### ตัวเลขแมปจากอะไร

| ตัวเลขบนแดชบอร์ด | ฟิลด์ใน Marketing API |
|---|---|
| ค่าโฆษณา | `spend` |
| เข้าถึง / อิมเพรสชัน / คลิก | `reach` / `impressions` / `clicks` |
| คนทักแชทใหม่ | `actions` → `onsite_conversion.messaging_conversation_started_7d` |
| ออเดอร์ | `actions` → `omni_purchase` (หรือ `purchase`) |
| ยอดขาย | `action_values` → `omni_purchase` (ต้องติดตั้ง Pixel/CAPI และตั้ง event Purchase ให้ส่งมูลค่า) |

ถ้าบัญชีคุณใช้ event ชื่ออื่น แก้รายการ `MSG_ACTION_TYPES` / `PURCHASE_ACTION_TYPES`
ได้ทั้งใน `index.html` และ `scripts/fetch-data.mjs`

## โครงสร้างข้อมูล

ทุกแหล่งข้อมูล (ตัวอย่าง / API / `data.json`) ถูกแปลงเป็นแถวรายวัน:

```js
{ date, spend, impressions, reach, clicks, conversations, purchases, revenue }
```

ข้อมูลรายคอนเท้นต์ (`contentDaily`) มีฟิลด์เดียวกัน บวก `name` และ `type`
ข้อมูลตัวอย่างสร้างจากฟังก์ชัน `sampleData()` ใน `index.html`
