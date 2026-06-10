const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const helmet = require('helmet');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { parse } = require('csv-parse/sync');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 8090;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-session-secret';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'wedding.db');
const DEFAULT_ADMIN_PASS = 'changeme';
const DEFAULT_SESSION_SECRET='change-this-session-secret';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (IS_PRODUCTION && ADMIN_PASS === DEFAULT_ADMIN_PASS) {
  console.error('[wedding-table-planner] Refusing to start in production with the default ADMIN_PASS.');
  process.exit(1);
}
if (IS_PRODUCTION && SESSION_SECRET === DEFAULT_SESSION_SECRET) {
  console.error('[wedding-table-planner] Refusing to start in production with the default SESSION_SECRET.');
  process.exit(1);
}

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);

const adminPasswordHash = bcrypt.hashSync(ADMIN_PASS, 10);

function clampInt(value, { min = 0, max = 1000, fallback = 0 } = {}) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizePresence(value) {
  const p = String(value || '').trim().toLowerCase();
  if (['oui', 'yes', 'present'].includes(p)) return 'oui';
  if (['peut-être', 'peut-etre', 'maybe', 'maybe?'].includes(p)) return 'peut-etre';
  if (['non', 'no'].includes(p)) return 'non';
  return '';
}

function normalizeGuestType(value) {
  const t = String(value || '').trim().toLowerCase();
  if (['bebe', 'bébé', 'baby', 'infant', 'toddlers', 'toddler'].includes(t)) return 'bebe';
  if (['enfant', 'child', 'kids', 'kid'].includes(t)) return 'enfant';
  return 'adulte';
}

function cleanText(value, maxLen = 500) {
  return String(value ?? '').trim().slice(0, maxLen);
}

function sanitizeRsvp(input = {}, { keepCreatedAt = true } = {}) {
  return {
    id: cleanText(input.id || crypto.randomUUID(), 80),
    nom: cleanText(input.nom, 120),
    prenom: cleanText(input.prenom, 120),
    presence: normalizePresence(input.presence),
    adultes: clampInt(input.adultes, { min: 0, max: 20, fallback: 0 }),
    enfants: clampInt(input.enfants, { min: 0, max: 20, fallback: 0 }),
    regime: cleanText(input.regime, 500),
    message: cleanText(input.message, 3000),
    phone: cleanText(input.phone, 80),
    adminNotes: cleanText(input.adminNotes, 2000),
    createdAt: keepCreatedAt && cleanText(input.createdAt, 80) ? cleanText(input.createdAt, 80) : new Date().toISOString(),
  };
}

function sanitizeGuest(input = {}, { keepRsvpFields = false } = {}) {
  // For table.guests: only keep essential placement fields
  // Legacy support: accept but don't persist adultes/enfants in table.guests
  const base = {
    id: cleanText(input.id || crypto.randomUUID(), 80),
    name: cleanText(input.name || 'Invité', 160) || 'Invité',
    type: normalizeGuestType(input.type),
    rsvpStatus: normalizePresence(input.rsvpStatus || input.presence),  // Accept both
    phone: cleanText(input.phone, 80),
    regime: cleanText(input.regime, 500),
    adminNotes: cleanText(input.adminNotes, 2000),
  };
  
  // Legacy support: keep RSVP-specific fields when explicitly requested
  if (keepRsvpFields) {
    base.sourceRsvpId = cleanText(input.sourceRsvpId, 80);
    base.adultes = clampInt(input.adultes, { min: 0, max: 20, fallback: 0 });
    base.enfants = clampInt(input.enfants, { min: 0, max: 20, fallback: 0 });
  }
  
  return base;
}

function sanitizeTable(input = {}) {
  const guests = Array.isArray(input.guests) ? input.guests.map(sanitizeGuest) : [];
  return {
    id: cleanText(input.id || crypto.randomUUID(), 80),
    name: cleanText(input.name || 'Table', 120) || 'Table',
    capacity: clampInt(input.capacity, { min: 1, max: 50, fallback: 10 }),
    guests,
  };
}

function sanitizePlan(input = {}) {
  const tables = Array.isArray(input.tables) ? input.tables.map(sanitizeTable) : [];
  const placedGuestIds = new Set(
    tables.flatMap(t => t.guests || []).map(g => g.id).filter(Boolean)
  );
  const guests = (Array.isArray(input.guests) ? input.guests.map(sanitizeGuest) : [])
    .filter(g => !g.id || !placedGuestIds.has(g.id));
  const layout = input.layout && typeof input.layout === 'object' ? input.layout : {};
  return {
    tables,
    guests,
    layout: {
      tables: layout.tables && typeof layout.tables === 'object' ? layout.tables : {},
      guests: layout.guests && typeof layout.guests === 'object' ? layout.guests : {},
    },
  };
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function serverError(res, err, context = 'server') {
  console.error(`[wedding-table-planner:${context}]`, err);
  return res.status(500).json({ ok: false, error: 'Erreur serveur' });
}

function removeTempDir(dirPath) {
  if (!dirPath) return;
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[wedding-table-planner] Unable to remove temp dir ${dirPath}:`, err.message);
  }
}

const CARD_THEMES = {
  'paper-white': { bgStart:'#fffdfa', bgEnd:'#f5f0eb', title:'#14110f', accent:'#4b3a31', label:'#14110f', chipBg:'#fffdfa', frame:'#c8bcb2' },
  'paper-cream': { bgStart:'#f8f1e8', bgEnd:'#eee4d9', title:'#14110f', accent:'#4b3a31', label:'#14110f', chipBg:'#f8f1e8', frame:'#beb0a4' },
  'theme-nude': { bgStart:'#fdf6ef', bgEnd:'#ebd9c8', title:'#ab7b4c', accent:'#bb8d67', label:'#8a6446', chipBg:'#fffaf7', frame:'#c8a98a' },
  'theme-sand': { bgStart:'#fbf4eb', bgEnd:'#decbb6', title:'#9d6f4c', accent:'#b38864', label:'#7d5f49', chipBg:'#fffaf5', frame:'#c0a07f' },
  'theme-blush': { bgStart:'#fbf0f0', bgEnd:'#e6c7ca', title:'#b06f7e', accent:'#c68e98', label:'#8f5f68', chipBg:'#fff9fa', frame:'#d3a0ab' },
  'theme-linen': { bgStart:'#f8f2ea', bgEnd:'#d8c8b8', title:'#9a775f', accent:'#b59278', label:'#7b624f', chipBg:'#fffbf8', frame:'#bea186' },
  'theme-clay': { bgStart:'#f8ece5', bgEnd:'#d9b49d', title:'#a45f43', accent:'#bc7d60', label:'#824f3c', chipBg:'#fff8f5', frame:'#c78969' },
  'theme-champagne': { bgStart:'#fbf7eb', bgEnd:'#e4d1a8', title:'#b58a3c', accent:'#caab63', label:'#866b3e', chipBg:'#fffdf8', frame:'#d1b06e' },
  'theme-ivory': { bgStart:'#fffdf8', bgEnd:'#e7ddcf', title:'#8f765c', accent:'#ac937b', label:'#6f6255', chipBg:'#ffffff', frame:'#cab8a5' },
  'theme-rosewater': { bgStart:'#fcf1f3', bgEnd:'#e9c8d3', title:'#b56f8e', accent:'#cb8fad', label:'#8d5d72', chipBg:'#fff9fb', frame:'#d8a0b9' },
  'theme-sage': { bgStart:'#f2f6ef', bgEnd:'#cad7c1', title:'#708261', accent:'#91a37f', label:'#59694d', chipBg:'#fbfffa', frame:'#9fb193' },
  'theme-olive': { bgStart:'#f3f2ea', bgEnd:'#d2cfb1', title:'#7c7a46', accent:'#9f9a62', label:'#615f3b', chipBg:'#fffef8', frame:'#afaa79' },
  'theme-eucalyptus': { bgStart:'#eef6f2', bgEnd:'#bfd8ce', title:'#4f8371', accent:'#73aa96', label:'#44685b', chipBg:'#f9fffc', frame:'#8db8a8' },
  'theme-forest-mist': { bgStart:'#eef3ef', bgEnd:'#bccbbd', title:'#5f765f', accent:'#7e9880', label:'#4f6150', chipBg:'#fbfffb', frame:'#95aa97' },
  'theme-dusty-blue': { bgStart:'#eff5fb', bgEnd:'#c7d7e6', title:'#6486a8', accent:'#86a8cb', label:'#536d86', chipBg:'#f9fcff', frame:'#9ab6cf' },
  'theme-powder-blue': { bgStart:'#f2f8fd', bgEnd:'#d4e3f1', title:'#7395b8', accent:'#94b5d5', label:'#5b7591', chipBg:'#fbfdff', frame:'#a6c2dd' },
  'theme-slate-blue': { bgStart:'#f0f3fb', bgEnd:'#c8d0e6', title:'#6879a0', accent:'#8797bf', label:'#55617f', chipBg:'#fafbff', frame:'#9dabc9' },
  'theme-french-blue': { bgStart:'#eef5fc', bgEnd:'#bfd6ef', title:'#4f79ac', accent:'#729fd5', label:'#486586', chipBg:'#f9fcff', frame:'#8eb4de' },
  'theme-lavender': { bgStart:'#f4f0fb', bgEnd:'#d9cceb', title:'#8770a8', accent:'#a68bc9', label:'#6c5b86', chipBg:'#fcfbff', frame:'#baa6d6' },
  'theme-mauve': { bgStart:'#f7f0f6', bgEnd:'#ddc3db', title:'#946483', accent:'#b884ab', label:'#765369', chipBg:'#fffafe', frame:'#c79cbc' },
  'theme-lilac': { bgStart:'#f7f3fd', bgEnd:'#ddd1f1', title:'#8b77b5', accent:'#ab95d5', label:'#705f92', chipBg:'#fcfbff', frame:'#bcaade' },
  'theme-peach': { bgStart:'#fdf1e6', bgEnd:'#f0c9b0', title:'#c57d4f', accent:'#dd9b6a', label:'#965f40', chipBg:'#fff9f5', frame:'#e1a97e' },
  'theme-apricot': { bgStart:'#fbf1e9', bgEnd:'#ebccb2', title:'#bb8357', accent:'#d29d74', label:'#936647', chipBg:'#fffaf6', frame:'#d8ae89' },
  'theme-coral': { bgStart:'#fcf0ec', bgEnd:'#ecbdb5', title:'#c1695b', accent:'#d88c7f', label:'#95584e', chipBg:'#fff9f7', frame:'#df9f96' },
  'theme-terracotta': { bgStart:'#f8ece7', bgEnd:'#d89e87', title:'#b65e41', accent:'#ce7b5d', label:'#874938', chipBg:'#fff8f5', frame:'#d48c73' },
  'theme-rust': { bgStart:'#f7ece7', bgEnd:'#cf9887', title:'#a4543e', accent:'#bf755d', label:'#7f4333', chipBg:'#fff8f6', frame:'#c98571' },
  'theme-cinnamon': { bgStart:'#f8f1ec', bgEnd:'#d8b5a2', title:'#986248', accent:'#b87f62', label:'#754c3a', chipBg:'#fffaf7', frame:'#c99379' },
  'theme-espresso': { bgStart:'#efe5df', bgEnd:'#b79282', title:'#6d473a', accent:'#8d6657', label:'#553a31', chipBg:'#fff9f7', frame:'#a88474' },
  'theme-charcoal': { bgStart:'#f0efef', bgEnd:'#c7c2c0', title:'#5f5753', accent:'#7d736f', label:'#4e4845', chipBg:'#ffffff', frame:'#9d9491' },
  'theme-minimal-black': { bgStart:'#f5f5f3', bgEnd:'#d6d2ce', title:'#292624', accent:'#5f5752', label:'#46403c', chipBg:'#ffffff', frame:'#807871' },
  'theme-gold-foil': { bgStart:'#fbf7eb', bgEnd:'#dfc27d', title:'#a67a19', accent:'#d7b04f', label:'#7b6223', chipBg:'#fffdf8', frame:'#d8b45a' },
  'theme-garden-party': { bgStart:'#f2f8ef', bgEnd:'#c7dcb2', title:'#658a56', accent:'#86b075', label:'#4f6a45', chipBg:'#fcfffb', frame:'#9cc38a' },
  'theme-modern-serif': { bgStart:'#faf8f4', bgEnd:'#d8d0c7', title:'#655b54', accent:'#8a7c72', label:'#564d47', chipBg:'#ffffff', frame:'#b1a59a' },
};

function getCardTheme(theme) {
  return CARD_THEMES[theme] || CARD_THEMES['paper-white'];
}

function densityClass(count) {
  if (count >= 15) return 'is-very-dense';
  if (count >= 11) return 'is-dense';
  return '';
}

function layoutClass(count) {
  return count >= 16 ? 'is-two-columns' : '';
}

function safeFileName(value, fallback = 'table') {
  return String(value || fallback).toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || fallback;
}

function findChromiumBinary() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/snap/bin/chromium',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const commandCandidates = ['chromium', 'chromium-browser', 'google-chrome'];
  for (const cmd of commandCandidates) {
    try {
      const resolved = execFileSync('bash', ['-lc', `command -v ${cmd}`], { encoding: 'utf8' }).trim();
      if (resolved && fs.existsSync(resolved)) return resolved;
    } catch {}
  }

  return null;
}

function buildCardHtml(table, themeName = 'paper-white') {
  const theme = getCardTheme(themeName);
  const guests = (table.guests || []).filter(Boolean).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base' }));
  const count = guests.length;
  const fromNumber = Number(table.number || table.numero || table.tableNumber || 0);
  const tableNumber = Number.isFinite(fromNumber) && fromNumber > 0
    ? String(fromNumber)
    : (String(table.name || '').match(/\d+/)?.[0] || '1');
  const classes = [
    'place-card',
    CARD_THEMES[themeName] ? themeName : 'paper-white',
    densityClass(count),
    layoutClass(count),
    count <= 6 ? 'has-few-guests' : (count <= 10 ? 'has-medium-guests' : '')
  ].filter(Boolean).join(' ');

  const guestHtml = guests.length
    ? guests.map(g => `<div class="guest-item">${escapeHtml(g.name || 'Invité')}</div>`).join('')
    : '<div class="guest-item">Table en préparation</div>';

  return `<!doctype html>
  <html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <style>
      html, body { margin:0; padding:0; width:1000px; height:1500px; background:#fff; }
      body { overflow:hidden; }
      .place-card {
        --poster-bg:${theme.bgStart}; --poster-bg-end:${theme.bgEnd}; --poster-edge:${theme.frame}; --poster-ink:${theme.title}; --poster-ornament:${theme.accent};
        position:relative; width:1000px; height:1500px; padding:56px 42px 70px; box-sizing:border-box; overflow:hidden;
        background: radial-gradient(circle at 50% 38%, rgba(255,255,255,.34), transparent 28%), linear-gradient(180deg, var(--poster-bg), var(--poster-bg-end));
        border:1px solid var(--poster-edge); border-radius:18px; display:flex; isolation:isolate;
        font-family:'Cormorant Garamond', Georgia, 'Times New Roman', serif; color:var(--poster-ink);
      }
      .place-card::before {
        content:''; position:absolute; inset:0;
        background: radial-gradient(circle at 50% 42%, rgba(255,255,255,.22), transparent 30%), linear-gradient(180deg, rgba(255,255,255,.22), transparent 18%);
        pointer-events:none; z-index:0;
      }
      .card-frame { position:absolute; inset:8px; border-radius:12px; border:1px solid var(--poster-edge); pointer-events:none; z-index:0; }
      .card-inner { position:relative; z-index:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-start; min-height:100%; width:100%; padding-top:195px; }
      .card-title { margin:0; font-family:'Bodoni Moda', 'Didot', 'Bodoni 72', Georgia, serif; font-size:78px; font-weight:500; line-height:1; text-align:center; color:var(--poster-ink); text-transform:uppercase; letter-spacing:.34em; text-shadow:0 1px 0 rgba(255,255,255,.5); }
      .guest-list { display:grid; gap:24px; width:100%; margin-top:102px; padding:0 42px; align-content:start; justify-content:center; }
      .guest-item { text-align:center; color:var(--poster-ink); font-size:58px; line-height:1.05; font-weight:600; letter-spacing:0; padding:0; }
      .has-few-guests .guest-list, .has-medium-guests .guest-list { align-content:start; gap:24px; }
      .has-few-guests .guest-item, .has-medium-guests .guest-item { font-size:58px; }
      .is-dense .guest-list { gap:18px; margin-top:82px; }
      .is-dense .guest-item { font-size:48px; }
      .is-very-dense .guest-list { gap:12px; margin-top:70px; }
      .is-very-dense .guest-item { font-size:40px; }
      .is-two-columns .guest-list { grid-template-columns:repeat(2, minmax(0, 1fr)); column-gap:18px; }
      .poster-ornament { margin-top:auto; padding-bottom:74px; width:325px; color:var(--poster-ornament); }
      .poster-ornament svg { display:block; width:100%; height:auto; }
    </style>
  </head>
  <body>
    <article class="${classes}">
      <div class="card-frame"></div>
      <div class="card-inner">
        <div class="card-title">Table ${escapeHtml(tableNumber)}</div>
        <div class="guest-list">${guestHtml}</div>
        <div class="poster-ornament" aria-hidden="true">
          <svg viewBox="0 0 180 34" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 18c18 2 32-4 47-14M20 19c9 7 20 8 33 2M39 10c-4-5-10-7-18-7M48 7c2 7 8 12 18 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M90 25s-18-10-12-22c6-8 12 2 12 2s6-10 12-2c6 12-12 22-12 22Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            <path d="M170 18c-18 2-32-4-47-14M160 19c-9 7-20 8-33 2M141 10c4-5 10-7 18-7M132 7c-2 7-8 12-18 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
      </div>
    </article>
  </body>
  </html>`;
}

function buildZip(files) {
  const records = [];
  let offset = 0;
  const chunks = [];

  for (const file of files) {
    const nameBuf = Buffer.from(file.name);
    const dataBuf = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const compressed = zlib.deflateRawSync(dataBuf);
    const crc = crc32(dataBuf);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, compressed);
    records.push({ nameBuf, crc, compressedSize: compressed.length, size: dataBuf.length, offset });
    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralChunks = [];
  let centralSize = 0;
  for (const record of records) {
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(record.crc >>> 0, 16);
    central.writeUInt32LE(record.compressedSize, 20);
    central.writeUInt32LE(record.size, 24);
    central.writeUInt16LE(record.nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(record.offset, 42);
    centralChunks.push(central, record.nameBuf);
    centralSize += central.length + record.nameBuf.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(records.length, 8);
  end.writeUInt16LE(records.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, ...centralChunks, end]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

db.exec(`CREATE TABLE IF NOT EXISTS rsvps (
  id TEXT PRIMARY KEY,
  nom TEXT,
  prenom TEXT,
  presence TEXT,
  adultes INTEGER,
  enfants INTEGER,
  regime TEXT,
  message TEXT,
  phone TEXT,
  adminNotes TEXT,
  createdAt TEXT
);
CREATE TABLE IF NOT EXISTS plan (
  id INTEGER PRIMARY KEY CHECK(id=1),
  data TEXT,
  updatedAt TEXT
);
CREATE TABLE IF NOT EXISTS plan_variants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);`);

const cols = db.prepare(`PRAGMA table_info(rsvps)`).all().map(c => c.name);
if (!cols.includes('phone')) db.exec(`ALTER TABLE rsvps ADD COLUMN phone TEXT`);
if (!cols.includes('adminNotes')) db.exec(`ALTER TABLE rsvps ADD COLUMN adminNotes TEXT`);


const EMPTY_PLAN = { tables: [], guests: [], layout: { tables: {}, guests: {} } };
const DEFAULT_PLAN_ID = 'default';

function nowIso() {
  return new Date().toISOString();
}

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row?.value || fallback;
}

function setSetting(key, value) {
  db.prepare(`INSERT INTO app_settings(key, value)
    VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value);
}

function ensureDefaultPlanVariant() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM plan_variants').get().count;
  if (count > 0) return;
  const legacy = db.prepare('SELECT data, updatedAt FROM plan WHERE id=1').get();
  const data = legacy?.data || JSON.stringify(EMPTY_PLAN);
  const timestamp = legacy?.updatedAt || nowIso();
  db.prepare(`INSERT INTO plan_variants(id, name, data, updatedAt, createdAt)
    VALUES(?, ?, ?, ?, ?)`).run(DEFAULT_PLAN_ID, 'Plan principal', data, timestamp, timestamp);
  setSetting('activePlanId', DEFAULT_PLAN_ID);
}

function getActivePlanId() {
  ensureDefaultPlanVariant();
  const configured = getSetting('activePlanId', DEFAULT_PLAN_ID);
  const exists = db.prepare('SELECT id FROM plan_variants WHERE id = ?').get(configured);
  if (exists) return configured;
  const first = db.prepare('SELECT id FROM plan_variants ORDER BY createdAt LIMIT 1').get();
  const fallback = first?.id || DEFAULT_PLAN_ID;
  setSetting('activePlanId', fallback);
  return fallback;
}

function listPlanVariants() {
  ensureDefaultPlanVariant();
  const activePlanId = getActivePlanId();
  return db.prepare('SELECT id, name, updatedAt, createdAt FROM plan_variants ORDER BY datetime(createdAt), name').all()
    .map(plan => ({ ...plan, active: plan.id === activePlanId }));
}

function getActivePlanRow() {
  const activePlanId = getActivePlanId();
  return db.prepare('SELECT id, name, data, updatedAt, createdAt FROM plan_variants WHERE id = ?').get(activePlanId);
}

function writeActivePlan(planData) {
  const sanitizedPlan = sanitizePlan(planData);
  const activePlanId = getActivePlanId();
  const data = JSON.stringify(sanitizedPlan);
  const updatedAt = nowIso();
  db.prepare('UPDATE plan_variants SET data = ?, updatedAt = ? WHERE id = ?').run(data, updatedAt, activePlanId);
  db.prepare(`INSERT INTO plan(id, data, updatedAt)
    VALUES(1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data=excluded.data, updatedAt=excluded.updatedAt`).run(data, updatedAt);
  return { data, updatedAt, activePlanId, plan: sanitizedPlan };
}

function createPlanVariant({ name, sourcePlanId }) {
  ensureDefaultPlanVariant();
  const id = crypto.randomUUID();
  const cleanName = cleanText(name, 120) || `Plan ${listPlanVariants().length + 1}`;
  const source = sourcePlanId
    ? db.prepare('SELECT data FROM plan_variants WHERE id = ?').get(sourcePlanId)
    : getActivePlanRow();
  const data = source?.data || JSON.stringify(EMPTY_PLAN);
  const timestamp = nowIso();
  db.prepare(`INSERT INTO plan_variants(id, name, data, updatedAt, createdAt)
    VALUES(?, ?, ?, ?, ?)`).run(id, cleanName, data, timestamp, timestamp);
  setSetting('activePlanId', id);
  return { id, name: cleanName, updatedAt: timestamp, createdAt: timestamp, active: true };
}

ensureDefaultPlanVariant();

app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    name: 'wtp.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PRODUCTION,
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

function requireAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  return res.redirect('/login.html');
}

if (ADMIN_PASS === DEFAULT_ADMIN_PASS) {
  console.warn('[wedding-table-planner] WARNING: ADMIN_PASS uses the default value. Change it before exposing the app.');
}
if (SESSION_SECRET === DEFAULT_SESSION_SECRET) {
  console.warn('[wedding-table-planner] WARNING: SESSION_SECRET uses the default value. Change it before exposing the app.');
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (username !== ADMIN_USER) return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  const ok = bcrypt.compareSync(String(password || ''), adminPasswordHash);
  if (!ok) return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  req.session.isAdmin = true;
  req.session.user = ADMIN_USER;
  return res.json({ ok: true });
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/auth/me', (req, res) => {
  res.json({ ok: !!req.session?.isAdmin, user: req.session?.user || null });
});

app.get('/api/rsvps', requireAdmin, (_req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM rsvps ORDER BY datetime(createdAt) DESC').all();
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rsvp', (req, res) => {
  try {
    const rsvp = sanitizeRsvp(req.body || {});
    if (!rsvp.nom || !rsvp.prenom) {
      return res.status(400).json({ ok: false, error: 'Nom et prénom requis' });
    }
    if (!rsvp.presence) {
      return res.status(400).json({ ok: false, error: 'Présence invalide' });
    }

    const stmt = db.prepare(`INSERT OR REPLACE INTO rsvps
      (id, nom, prenom, presence, adultes, enfants, regime, message, phone, adminNotes, createdAt)
      VALUES (@id, @nom, @prenom, @presence, @adultes, @enfants, @regime, @message, @phone, @adminNotes, @createdAt)`);
    stmt.run(rsvp);
    res.json({ ok: true, id: rsvp.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/rsvp/:id', requireAdmin, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM rsvps WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, rsvp: row });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put('/api/rsvp/:id', requireAdmin, (req, res) => {
  try {
    const id = cleanText(req.params.id, 80);
    const existing = db.prepare('SELECT * FROM rsvps WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });

    const next = sanitizeRsvp({ ...existing, ...req.body, id, createdAt: existing.createdAt });
    const info = db.prepare(`UPDATE rsvps SET
      presence=@presence,
      adultes=@adultes,
      enfants=@enfants,
      regime=@regime,
      message=@message,
      phone=@phone,
      adminNotes=@adminNotes
      WHERE id=@id`).run(next);
    res.json({ ok: true, updated: info.changes || 0 });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/rsvp/:id', requireAdmin, (req, res) => {
  try {
    const id = req.params.id;
    const info = db.prepare('DELETE FROM rsvps WHERE id = ?').run(id);
    res.json({ ok: true, deleted: info.changes || 0 });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/plans', requireAdmin, (_req, res) => {
  try {
    res.json({ ok: true, plans: listPlanVariants(), activePlanId: getActivePlanId() });
  } catch (err) {
    serverError(res, err, 'plans-list');
  }
});

app.post('/api/plans', requireAdmin, (req, res) => {
  try {
    const plan = createPlanVariant({ name: req.body?.name, sourcePlanId: req.body?.sourcePlanId });
    res.json({ ok: true, plan, plans: listPlanVariants(), activePlanId: plan.id });
  } catch (err) {
    serverError(res, err, 'plans-create');
  }
});

app.post('/api/plans/:id/activate', requireAdmin, (req, res) => {
  try {
    const id = cleanText(req.params.id, 80);
    const plan = db.prepare('SELECT id, data, updatedAt FROM plan_variants WHERE id = ?').get(id);
    if (!plan) return res.status(404).json({ ok: false, error: 'Plan introuvable' });
    setSetting('activePlanId', id);
    db.prepare(`INSERT INTO plan(id, data, updatedAt)
      VALUES(1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data=excluded.data, updatedAt=excluded.updatedAt`).run(plan.data, plan.updatedAt || nowIso());
    res.json({ ok: true, activePlanId: id, plans: listPlanVariants() });
  } catch (err) {
    serverError(res, err, 'plans-activate');
  }
});

app.get('/api/plan', requireAdmin, (_req, res) => {
  try {
    const row = getActivePlanRow();
    const data = row?.data ? sanitizePlan(JSON.parse(row.data)) : EMPTY_PLAN;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/plan', requireAdmin, (req, res) => {
  try {
    writeActivePlan(req.body || {});
    res.json({ ok: true, activePlanId: getActivePlanId() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/import-csv', requireAdmin, (req, res) => {
  try {
    const csvText = req.body.csv || '';
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    const guests = records.map((r) => ({
      id: crypto.randomUUID(),
      name: cleanText([r.prenom || r.first_name || '', r.nom || r.last_name || ''].join(' ').trim() || r.name || 'Invité', 160) || 'Invité',
      type: normalizeGuestType(r.type),
      group: cleanText(r.groupe || r.group || '', 120),
    }));

    res.json({ ok: true, guests, count: guests.length });
  } catch (_e) {
    res.status(400).json({ ok: false, error: 'CSV invalide' });
  }
});

app.get('/api/config/export', requireAdmin, (_req, res) => {
  try {
    const rsvps = db.prepare('SELECT * FROM rsvps ORDER BY datetime(createdAt) DESC').all();
    const planRow = getActivePlanRow();
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      rsvps,
      plan: planRow?.data ? JSON.parse(planRow.data) : { tables: [], guests: [] },
      planUpdatedAt: planRow?.updatedAt || null,
    };
    res.json(payload);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/export/caterer.csv', requireAdmin, (_req, res) => {
  try {
    const rsvps = db.prepare('SELECT * FROM rsvps').all();
    const planRow = getActivePlanRow();
    const plan = planRow?.data ? JSON.parse(planRow.data) : { tables: [], guests: [] };
    const tables = plan.tables || [];

    const cleanName = (n) => String(n || '').replace(/\s*\((Adulte|Enfant|Bébé)\s*\d+\)$/i, '').trim();
    const escapeCsv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const findRsvp = (guestName) => {
      const base = cleanName(guestName).toLowerCase();
      return rsvps.find(r => `${(r.prenom||'').trim()} ${(r.nom||'').trim()}`.trim().toLowerCase() === base);
    };

    const lines = [];
    lines.push(['table', 'invité', 'type', 'allergies/régime'].map(escapeCsv).join(','));

    for (const t of tables) {
      for (const g of (t.guests || [])) {
        const r = findRsvp(g.name);
        lines.push([
          t.name || '',
          g.name || '',
          g.type || 'adulte',
          r?.regime || ''
        ].map(escapeCsv).join(','));
      }
    }

    lines.push('');
    lines.push(['table', 'total', 'adultes', 'enfants', 'bébés'].map(escapeCsv).join(','));
    for (const t of tables) {
      const gs = t.guests || [];
      const ad = gs.filter(g => String(g.type||'adulte') === 'adulte').length;
      const en = gs.filter(g => String(g.type||'') === 'enfant').length;
      const bb = gs.filter(g => String(g.type||'') === 'bebe').length;
      lines.push([t.name || '', gs.length, ad, en, bb].map(escapeCsv).join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="traiteur-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(lines.join('\n'));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/postcards/export', requireAdmin, (req, res) => {
  let tmpBase;
  try {
    const format = String(req.query.format || 'png').toLowerCase() === 'jpg' ? 'jpg' : 'png';
    const theme = cleanText(req.query.theme || 'paper-white', 80) || 'paper-white';
    const planRow = getActivePlanRow();
    const plan = planRow?.data ? sanitizePlan(JSON.parse(planRow.data)) : { tables: [], guests: [] };
    const tables = (plan.tables || []).filter(Boolean);
    if (!tables.length) return res.status(400).json({ ok: false, error: 'Aucune table disponible' });

    const chromiumPath = findChromiumBinary();
    if (!chromiumPath) {
      return res.status(500).json({ ok: false, error: 'Chromium introuvable sur le serveur pour l’export cartes.' });
    }

    tmpBase = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wtp-cards-'));
    const files = tables.map((table, index) => {
      const htmlPath = path.join(tmpBase, `card-${index}.html`);
      const pngPath = path.join(tmpBase, `card-${index}.png`);
      fs.writeFileSync(htmlPath, buildCardHtml(table, theme), 'utf8');
      execFileSync(chromiumPath, [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        `--screenshot=${pngPath}`,
        '--window-size=1000,1500',
        `file://${htmlPath}`,
      ], { stdio: 'ignore' });
      const pngBuffer = fs.readFileSync(pngPath);
      return { name: `${safeFileName(table.name, 'table')}.${format}`, data: pngBuffer };
    });

    const zipBuffer = buildZip(files);
    const archiveName = `wedding-cards-${safeFileName(theme, 'theme')}-${format}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`);
    res.send(zipBuffer);
  } catch (err) {
    serverError(res, err, 'postcards-export');
  } finally {
    removeTempDir(tmpBase);
  }
});

app.get('/api/postcards/export.pdf', requireAdmin, (req, res) => {
  let tmpBase;
  try {
    const theme = cleanText(req.query.theme || 'paper-white', 80) || 'paper-white';
    const chromiumPath = findChromiumBinary();
    if (!chromiumPath) {
      return res.status(500).json({ ok: false, error: 'Chromium introuvable sur le serveur pour générer le PDF cartes.' });
    }

    tmpBase = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wtp-pdf-'));
    const htmlPath = path.join(tmpBase, 'cards.html');
    const pdfPath = path.join(tmpBase, 'cards.pdf');

    const planRow = getActivePlanRow();
    const plan = planRow?.data ? sanitizePlan(JSON.parse(planRow.data)) : { tables: [], guests: [] };
    const tables = (plan.tables || []).filter(Boolean);
    if (!tables.length) return res.status(400).json({ ok: false, error: 'Aucune table disponible' });

    const cardsHtml = tables.map(table => buildCardHtml(table, theme).match(/<article class="place-card[\s\S]*?<\/article>/)?.[0] || '').join('');
    const html = `<!doctype html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8" />
      <style>
        @page { size: 10cm 15cm; margin: 0; }
        html, body { margin:0; padding:0; background:#fff; }
        body { margin:0; }
        .sheet { width:10cm; height:15cm; page-break-after:always; break-after:page; }
        .sheet:last-child { page-break-after:auto; break-after:auto; }
      </style>
    </head>
    <body>
      ${cardsHtml.split(/(?=<article class="place-card)/).filter(Boolean).map(card => `<div class="sheet">${card}</div>`).join('')}
    </body>
    </html>`;

    fs.writeFileSync(htmlPath, html, 'utf8');
    execFileSync(chromiumPath, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--print-to-pdf=${pdfPath}`,
      '--no-pdf-header-footer',
      htmlPath.startsWith('/') ? `file://${htmlPath}` : htmlPath,
    ], { stdio: 'ignore' });

    const pdfBuffer = fs.readFileSync(pdfPath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="wedding-cards-${safeFileName(theme, 'theme')}-10x15.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    serverError(res, err, 'postcards-export-pdf');
  } finally {
    removeTempDir(tmpBase);
  }
});

app.post('/api/config/import', requireAdmin, (req, res) => {
  try {
    const payload = req.body || {};
    if (!Array.isArray(payload.rsvps) || typeof payload.plan !== 'object' || payload.plan === null) {
      return res.status(400).json({ ok: false, error: 'Format de config invalide' });
    }

    const sanitizedRsvps = payload.rsvps.map((r) => sanitizeRsvp(r));
    const sanitizedPlan = sanitizePlan(payload.plan);

    const insertRsvp = db.prepare(`INSERT OR REPLACE INTO rsvps
      (id, nom, prenom, presence, adultes, enfants, regime, message, phone, adminNotes, createdAt)
      VALUES (@id, @nom, @prenom, @presence, @adultes, @enfants, @regime, @message, @phone, @adminNotes, @createdAt)`);

    let writeResult;
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM rsvps').run();
      for (const r of sanitizedRsvps) {
        insertRsvp.run(r);
      }
      writeResult = writeActivePlan(sanitizedPlan);
    });

    tx();
    res.json({ ok: true, importedRsvps: sanitizedRsvps.length, activePlanId: writeResult.activePlanId, plan: writeResult.plan });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get(['/admin.html', '/visual.html', '/day-of.html', '/staff.html', '/postcards.html'], requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, path.basename(req.path)));
});
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/index.html', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login.html', (_req, res) => res.sendFile(path.join(__dirname, 'login.html')));

const PUBLIC_STATIC_FILES = new Set([
  '/styles.css',
  '/theme.js',
  '/header.js',
  '/favicon.ico',
]);

app.use((req, res, next) => {
  if (PUBLIC_STATIC_FILES.has(req.path)) return next();
  return res.status(404).end();
});
app.use(express.static(__dirname, { index: false, dotfiles: 'deny' }));

app.listen(PORT, () => {
  console.log(`wedding-table-planner listening on :${PORT}`);
});
