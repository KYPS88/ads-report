#!/usr/bin/env node
/**
 * ดึงข้อมูลจาก Meta Marketing API แล้วเขียนไฟล์ข้อมูลให้ index.html อ่าน
 *
 * วิธีใช้ (ต้องมี Node 18 ขึ้นไป):
 *   META_AD_ACCOUNT_IDS="act_1111111111, act_2222222222" \
 *   META_ACCESS_TOKEN=EAAB... \
 *   node scripts/fetch-data.mjs
 *
 * โหมดข้อมูล:
 * - ไม่ตั้ง DASHBOARD_USERS  -> เขียน data.json (อ่านได้เลย ไม่ต้องล็อกอิน)
 * - ตั้ง DASHBOARD_USERS     -> เขียน data.enc.json (เข้ารหัส AES-256-GCM
 *   ด้วยกุญแจที่ห่อไว้ด้วยรหัสผ่านของแต่ละผู้ใช้) หน้าเว็บจะขึ้นหน้าล็อกอิน
 *   รูปแบบ: DASHBOARD_USERS="สมชาย:รหัสผ่าน1,สมหญิง:รหัสผ่าน2"
 *   (คั่นผู้ใช้ด้วยจุลภาค, คั่นชื่อกับรหัสด้วย : ตัวแรก)
 *
 * ใช้กับ GitHub Actions: ตั้ง secrets META_ACCESS_TOKEN, META_AD_ACCOUNT_IDS,
 * DASHBOARD_USERS แล้ว workflow .github/workflows/pages.yml จะรันสคริปต์นี้
 * และ deploy ขึ้น GitHub Pages ให้อัตโนมัติ (ข้อมูลไม่ถูก commit ลง repo)
 */

import { writeFileSync } from "node:fs";
import { randomBytes, pbkdf2Sync, createCipheriv } from "node:crypto";

const API_VERSION = "v23.0";
const ACCOUNT_DAYS = 180; // กราฟรายวัน + เดลต้าเทียบช่วงก่อนหน้า (90+90)
const AD_DAYS = 90;       // ตารางคอนเท้นต์ครอบคลุมตัวกรองสูงสุด 90 วัน
const PBKDF2_ITERATIONS = 310000;

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

const rawIds = process.env.META_AD_ACCOUNT_IDS || process.env.META_AD_ACCOUNT_ID || "";
const token = process.env.META_ACCESS_TOKEN || "";
if (!rawIds || !token) {
  console.error("ต้องตั้ง environment variables META_AD_ACCOUNT_IDS และ META_ACCESS_TOKEN ก่อน");
  console.error('ตัวอย่าง: META_AD_ACCOUNT_IDS="act_1111111111, act_2222222222" META_ACCESS_TOKEN=EAAB... node scripts/fetch-data.mjs');
  process.exit(1);
}
const acctIds = [...new Set(rawIds.split(/[\s,]+/).filter(Boolean).map(id => {
  if (/^\d+$/.test(id)) id = "act_" + id;
  if (!/^act_\d+$/.test(id)) {
    console.error(`"${id}" ไม่ใช่ Ad Account ID — ต้องอยู่ในรูปแบบ act_1234567890`);
    process.exit(1);
  }
  return id;
}))];

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

async function fetchAccount(acct) {
  const base = `https://graph.facebook.com/${API_VERSION}/${acct}/insights`;
  const common = `access_token=${encodeURIComponent(token)}&time_increment=1&limit=500`;

  let name = acct;
  try {
    const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${acct}?fields=name&access_token=${encodeURIComponent(token)}`);
    const js = await res.json();
    if (!js.error && js.name) name = js.name;
  } catch { /* ใช้ id แทนชื่อ */ }

  console.error(`[${acct}] ดึงข้อมูลรายวันระดับบัญชี (${ACCOUNT_DAYS} วัน)...`);
  const accountRows = await fbFetchAll(`${base}?${common}` +
    `&time_range=${timeRange(ACCOUNT_DAYS)}&fields=spend,impressions,reach,clicks,actions,action_values`);

  console.error(`[${acct}] ดึงข้อมูลรายวันระดับโฆษณา (${AD_DAYS} วัน)...`);
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
  return { id: acct, name, daily, contentDaily };
}

const accounts = [];
for (const id of acctIds) accounts.push(await fetchAccount(id));

const payload = { version: 2, generatedAt: new Date().toISOString(), accounts };
const usersRaw = (process.env.DASHBOARD_USERS || "").trim();

if (!usersRaw) {
  writeFileSync(new URL("../data.json", import.meta.url), JSON.stringify(payload));
  console.error(`เขียน data.json แล้ว (ไม่เข้ารหัส) — ${accounts.length} บัญชี`);
} else {
  /* เข้ารหัส payload ด้วย master key แล้วห่อ master key ด้วยรหัสผ่านของแต่ละผู้ใช้ */
  const users = usersRaw.split(",").map(pair => {
    const i = pair.indexOf(":");
    if (i <= 0) {
      console.error(`DASHBOARD_USERS ผิดรูปแบบ: "${pair}" — ต้องเป็น ชื่อผู้ใช้:รหัสผ่าน`);
      process.exit(1);
    }
    return { username: pair.slice(0, i).trim(), password: pair.slice(i + 1) };
  });

  const master = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", master, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final(), cipher.getAuthTag()]);

  const userEntries = users.map(u => {
    const salt = randomBytes(16);
    const kek = pbkdf2Sync(u.password, salt, PBKDF2_ITERATIONS, 32, "sha256");
    const wiv = randomBytes(12);
    const wc = createCipheriv("aes-256-gcm", kek, wiv);
    const wrapped = Buffer.concat([wc.update(master), wc.final(), wc.getAuthTag()]);
    return {
      username: u.username,
      salt: salt.toString("base64"),
      iv: wiv.toString("base64"),
      wrappedKey: wrapped.toString("base64"),
    };
  });

  const out = {
    version: 2,
    encrypted: true,
    generatedAt: payload.generatedAt,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ITERATIONS },
    users: userEntries,
    iv: iv.toString("base64"),
    ciphertext: ct.toString("base64"),
  };
  writeFileSync(new URL("../data.enc.json", import.meta.url), JSON.stringify(out));
  console.error(`เขียน data.enc.json แล้ว (เข้ารหัส) — ${accounts.length} บัญชี, ผู้ใช้ ${userEntries.length} คน`);
}
