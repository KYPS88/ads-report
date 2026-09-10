#!/usr/bin/env node
/**
 * ดึงข้อมูลจาก Meta Marketing API แล้วเขียนเป็น data.json ให้ index.html อ่าน
 *
 * วิธีใช้ (ต้องมี Node 18 ขึ้นไป):
 *   META_AD_ACCOUNT_ID=act_1234567890 META_ACCESS_TOKEN=EAAB... node scripts/fetch-data.mjs
 *
 * เหมาะกับกรณีโฮสต์แดชบอร์ดเป็นเว็บ (GitHub Pages / Cloudflare Pages ฯลฯ)
 * — รันสคริปต์นี้ตามรอบเวลา (cron / GitHub Actions) เพื่ออัปเดต data.json
 * โดยไม่ต้องวาง access token ไว้ในหน้าเว็บ
 */

const API_VERSION = "v23.0";
const ACCOUNT_DAYS = 180; // กราฟรายวัน + เดลต้าเทียบช่วงก่อนหน้า (90+90)
const AD_DAYS = 90;       // ตารางคอนเท้นต์ครอบคลุมตัวกรองสูงสุด 90 วัน

const MSG_ACTION_TYPES = [
  "onsite_conversion.messaging_conversation_started_7d",
  "onsite_conversion.total_messaging_connection",
];
const PURCHASE_ACTION_TYPES = [
  "omni_purchase",
  "purchase",
  "onsite_conversion.purchase",
  "offsite_conversion.fb_pixel_purchase",
];

let acct = process.env.META_AD_ACCOUNT_ID || "";
const token = process.env.META_ACCESS_TOKEN || "";
if (!acct || !token) {
  console.error("ต้องตั้ง environment variables META_AD_ACCOUNT_ID และ META_ACCESS_TOKEN ก่อน");
  console.error("ตัวอย่าง: META_AD_ACCOUNT_ID=act_1234567890 META_ACCESS_TOKEN=EAAB... node scripts/fetch-data.mjs");
  process.exit(1);
}
if (/^\d+$/.test(acct)) acct = "act_" + acct;
if (!/^act_\d+$/.test(acct)) {
  console.error("META_AD_ACCOUNT_ID ต้องอยู่ในรูปแบบ act_1234567890");
  process.exit(1);
}

function isoDate(d) {
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function pickAction(list, types) {
  for (const t of types) {
    const hit = (list || []).find(a => a.action_type === t);
    if (hit && Number(hit.value) > 0) return Number(hit.value);
  }
  return 0;
}
function mapRow(r) {
  return {
    date: r.date_start,
    spend: Math.round(Number(r.spend || 0)),
    impressions: Number(r.impressions || 0),
    reach: Number(r.reach || 0),
    clicks: Number(r.clicks || 0),
    conversations: pickAction(r.actions, MSG_ACTION_TYPES),
    purchases: pickAction(r.actions, PURCHASE_ACTION_TYPES),
    revenue: Math.round(pickAction(r.action_values, PURCHASE_ACTION_TYPES)),
  };
}

async function fbFetchAll(url) {
  const rows = [];
  let next = url, guard = 0;
  while (next && guard++ < 50) {
    const res = await fetch(next);
    const js = await res.json();
    if (js.error) throw new Error(js.error.message || "Graph API error");
    rows.push(...(js.data || []));
    next = js.paging && js.paging.next;
  }
  return rows;
}

const today = new Date(); today.setHours(0, 0, 0, 0);
function timeRange(days) {
  const since = new Date(today); since.setDate(since.getDate() - (days - 1));
  return encodeURIComponent(JSON.stringify({ since: isoDate(since), until: isoDate(today) }));
}

const base = `https://graph.facebook.com/${API_VERSION}/${acct}/insights`;
const common = `access_token=${encodeURIComponent(token)}&time_increment=1&limit=500`;

console.error(`ดึงข้อมูลรายวันระดับบัญชี (${ACCOUNT_DAYS} วัน)...`);
const accountRows = await fbFetchAll(`${base}?${common}` +
  `&time_range=${timeRange(ACCOUNT_DAYS)}&fields=spend,impressions,reach,clicks,actions,action_values`);

console.error(`ดึงข้อมูลรายวันระดับโฆษณา (${AD_DAYS} วัน)...`);
const adRows = await fbFetchAll(`${base}?${common}` +
  `&time_range=${timeRange(AD_DAYS)}&level=ad&fields=ad_name,spend,impressions,reach,clicks,actions,action_values`);

/* เติมวันที่ไม่มีข้อมูลด้วยศูนย์ ให้กราฟต่อเนื่อง */
const byDate = new Map(accountRows.map(r => [r.date_start, mapRow(r)]));
const daily = [];
for (let i = ACCOUNT_DAYS - 1; i >= 0; i--) {
  const d = new Date(today); d.setDate(d.getDate() - i);
  const key = isoDate(d);
  daily.push(byDate.get(key) ||
    { date: key, spend: 0, impressions: 0, reach: 0, clicks: 0, conversations: 0, purchases: 0, revenue: 0 });
}

const contentDaily = adRows.map(r => ({ ...mapRow(r), name: r.ad_name || "(ไม่มีชื่อ)", type: "" }));

const out = { generatedAt: new Date().toISOString(), account: acct, daily, contentDaily };
const { writeFileSync } = await import("node:fs");
writeFileSync(new URL("../data.json", import.meta.url), JSON.stringify(out));
console.error(`เขียน data.json แล้ว — ${daily.length} วัน, ${contentDaily.length} แถวรายโฆษณา`);
