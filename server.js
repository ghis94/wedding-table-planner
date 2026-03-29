const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const helmet = require('helmet');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { parse } = require('csv-parse/sync');
const { Resvg } = require('@resvg/resvg-js');
const zlib = require('zlib');

const app = express();
const PORT = process.env.PORT || 8090;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-session-secret';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'wedding.db');
const DEFAULT_ADMIN_PASS = 'changeme';
const DEFAULT_SESSION_SECRET = 'change-this-session-secret';

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
  const guests = Array.isArray(input.guests) ? input.guests.map(sanitizeGuest) : [];
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

const CARD_THEMES = {
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
  return CARD_THEMES[theme] || CARD_THEMES['theme-nude'];
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

function buildCardSvg(table, themeName = 'theme-nude') {
  const theme = getCardTheme(themeName);
  const guests = (table.guests || []).filter(Boolean).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base' }));
  const count = guests.length;
  const density = densityClass(count);
  const isDense = density === 'is-dense';
  const isVeryDense = density === 'is-very-dense';
  const twoCols = layoutClass(count) === 'is-two-columns';
  const width = 1000;
  const height = 1500;

  const padX = isVeryDense ? 62 : (isDense ? 70 : 78);
  const padTop = isVeryDense ? 66 : (isDense ? 76 : 86);
  const padBottom = isVeryDense ? 50 : (isDense ? 58 : 68);
  const frameInset = isVeryDense ? 8 : 10;
  const safeInset = 22;
  const titleSize = isVeryDense ? 44 : (isDense ? 54 : 64);
  const eyebrowSize = isVeryDense ? 11 : (isDense ? 12 : 13);
  const subtitleSize = isVeryDense ? 15 : (isDense ? 17 : 18);
  const summarySize = isVeryDense ? 12 : (isDense ? 13 : 14);
  const hasFewGuests = count <= 6;
  const hasMediumGuests = count > 6 && count <= 10;
  const guestFontSize = hasFewGuests ? 30 : (hasMediumGuests ? 26 : (isVeryDense ? 19 : (isDense ? 22 : 25)));
  const guestLineHeight = hasFewGuests ? 42 : (hasMediumGuests ? 36 : (isVeryDense ? 28 : (isDense ? 33 : 38)));
  const guestGap = hasFewGuests ? 18 : (hasMediumGuests ? 14 : (isVeryDense ? 10 : (isDense ? 12 : 14)));
  const listTop = hasFewGuests ? 470 : (hasMediumGuests ? 450 : (isVeryDense ? 408 : (isDense ? 452 : 500)));
  const footerSize = isVeryDense ? 11 : (isDense ? 12 : 13);
  const footerY = height - (isVeryDense ? 54 : 66);
  const listWidth = width - padX * 2;
  const colGap = twoCols ? 18 : 0;
  const colWidth = twoCols ? Math.floor((listWidth - colGap) / 2) : listWidth;

  const rows = twoCols ? Math.ceil(count / 2) : count;
  const totalListHeight = rows ? rows * guestLineHeight + (rows - 1) * guestGap : guestLineHeight;
  const maxListHeight = footerY - 30 - listTop;
  const centeredTop = hasFewGuests || hasMediumGuests ? Math.max(listTop, Math.round((footerY + listTop - totalListHeight) / 2)) : listTop;
  const adjustedListTop = totalListHeight > maxListHeight ? Math.max(360, footerY - 30 - totalListHeight) : centeredTop;

  const guestBoxes = guests.map((guest, index) => {
    const col = twoCols ? (index % 2) : 0;
    const row = twoCols ? Math.floor(index / 2) : index;
    const x = padX + col * (colWidth + colGap);
    const y = adjustedListTop + row * (guestLineHeight + guestGap);
    return `
      <g>
        <text x="${x + colWidth / 2}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-family="Georgia, Times New Roman, serif" font-size="${guestFontSize}" font-style="italic" font-weight="600" fill="#5c4332">${escapeHtml(guest.name || 'Invité')}</text>
      </g>`;
  }).join('');

  const summaryText = count ? `${count} invité${count > 1 ? 's' : ''}` : 'Placement en cours';
  const frameX = frameInset * 4;
  const frameY = frameInset * 4;
  const frameW = width - frameX * 2;
  const frameH = height - frameY * 2;
  const safeX = safeInset * 4;
  const safeY = safeInset * 4;
  const safeW = width - safeX * 2;
  const safeH = height - safeY * 2;

  const title = escapeHtml(table.name || 'Table');
  const guestTexts = guests.map((guest, index) => {
    const col = twoCols ? (index % 2) : 0;
    const row = twoCols ? Math.floor(index / 2) : index;
    const x = padX + col * (colWidth + colGap) + colWidth / 2;
    const y = adjustedListTop + row * (guestLineHeight + guestGap);
    return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" style="font-family: Georgia, serif; font-size: ${guestFontSize}px; font-style: italic; font-weight: 600; fill: #5c4332;">${escapeHtml(guest.name || 'Invité')}</text>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${theme.bgStart}"/>
        <stop offset="100%" stop-color="${theme.bgEnd}"/>
      </linearGradient>
      <radialGradient id="glowTop" cx="82%" cy="12%" r="24%">
        <stop offset="0%" stop-color="${theme.accent}" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="${theme.accent}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="glowBottom" cx="16%" cy="88%" r="26%">
        <stop offset="0%" stop-color="${theme.label}" stop-opacity="0.12"/>
        <stop offset="100%" stop-color="${theme.label}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1000" height="1500" fill="url(#bg)"/>
    <rect width="1000" height="1500" fill="url(#glowTop)"/>
    <rect width="1000" height="1500" fill="url(#glowBottom)"/>

    <rect x="${frameX}" y="${frameY}" width="${frameW}" height="${frameH}" rx="22" fill="none" stroke="${theme.frame}" stroke-opacity="0.7"/>
    <circle cx="500" cy="${frameY}" r="11" fill="#ffffff" fill-opacity="0.5" stroke="${theme.frame}" stroke-opacity="0.9"/>
    <circle cx="500" cy="${frameY + frameH}" r="11" fill="#ffffff" fill-opacity="0.5" stroke="${theme.frame}" stroke-opacity="0.9"/>
    <rect x="${safeX}" y="${safeY}" width="${safeW}" height="${safeH}" rx="18" fill="none" stroke="${theme.frame}" stroke-opacity="0.38" stroke-dasharray="10 8"/>

    <text x="500" y="${padTop}" text-anchor="middle" dominant-baseline="middle" style="font-family: Georgia, serif; font-size: ${eyebrowSize}px; font-weight: 700; fill: ${theme.label};">Mariage</text>
    <text x="500" y="${padTop + 88}" text-anchor="middle" dominant-baseline="middle" style="font-family: Georgia, serif; font-size: ${titleSize}px; font-style: italic; fill: ${theme.title};">${title}</text>
    <line x1="430" x2="570" y1="${padTop + 132}" y2="${padTop + 132}" stroke="${theme.accent}" stroke-width="1.2"/>
    <text x="500" y="${padTop + 170}" text-anchor="middle" dominant-baseline="middle" style="font-family: Georgia, serif; font-size: ${subtitleSize}px; fill: ${theme.label};">Votre table</text>
    <text x="500" y="${padTop + 206}" text-anchor="middle" dominant-baseline="middle" style="font-family: Georgia, serif; font-size: ${summarySize}px; font-weight: 600; fill: ${theme.label};">${escapeHtml(summaryText)}</text>

    ${guestTexts || `<text x="500" y="${adjustedListTop}" text-anchor="middle" dominant-baseline="middle" style="font-family: Georgia, serif; font-size: ${guestFontSize}px; font-style: italic; font-weight: 600; fill: #5c4332;">Table en préparation</text>`}

    <text x="500" y="${footerY}" text-anchor="middle" dominant-baseline="middle" style="font-family: Georgia, serif; font-size: ${footerSize}px; font-weight: 600; fill: ${theme.label};">Avec amour &amp; célébration</text>
  </svg>`;
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
);`);

const cols = db.prepare(`PRAGMA table_info(rsvps)`).all().map(c => c.name);
if (!cols.includes('phone')) db.exec(`ALTER TABLE rsvps ADD COLUMN phone TEXT`);
if (!cols.includes('adminNotes')) db.exec(`ALTER TABLE rsvps ADD COLUMN adminNotes TEXT`);

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
      secure: false,
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

app.get('/api/plan', requireAdmin, (_req, res) => {
  try {
    const row = db.prepare('SELECT data FROM plan WHERE id=1').get();
    const data = row?.data ? sanitizePlan(JSON.parse(row.data)) : { tables: [], guests: [], layout: { tables: {}, guests: {} } };
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/plan', requireAdmin, (req, res) => {
  try {
    const sanitizedPlan = sanitizePlan(req.body || {});
    const data = JSON.stringify(sanitizedPlan);
    db.prepare(
      `INSERT INTO plan(id, data, updatedAt)
       VALUES(1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data=excluded.data, updatedAt=excluded.updatedAt`
    ).run(data, new Date().toISOString());
    res.json({ ok: true });
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
    const planRow = db.prepare('SELECT data, updatedAt FROM plan WHERE id=1').get();
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
    const planRow = db.prepare('SELECT data FROM plan WHERE id=1').get();
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
  try {
    const format = String(req.query.format || 'png').toLowerCase() === 'jpg' ? 'jpg' : 'png';
    const theme = cleanText(req.query.theme || 'theme-nude', 80) || 'theme-nude';
    const planRow = db.prepare('SELECT data FROM plan WHERE id=1').get();
    const plan = planRow?.data ? sanitizePlan(JSON.parse(planRow.data)) : { tables: [], guests: [] };
    const tables = (plan.tables || []).filter(Boolean);
    if (!tables.length) return res.status(400).json({ ok: false, error: 'Aucune table disponible' });

    const files = tables.map((table) => {
      const svg = buildCardSvg(table, theme);
      const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1000 } });
      const pngBuffer = resvg.render().asPng();
      const fileName = `${safeFileName(table.name, 'table')}.${format}`;
      return { name: fileName, data: pngBuffer };
    });

    const zipBuffer = buildZip(files);
    const archiveName = `wedding-cards-${safeFileName(theme, 'theme')}-${format}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`);
    res.send(zipBuffer);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
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

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM rsvps').run();
      for (const r of sanitizedRsvps) {
        insertRsvp.run(r);
      }
      db.prepare(
        `INSERT INTO plan(id, data, updatedAt)
         VALUES(1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data=excluded.data, updatedAt=excluded.updatedAt`
      ).run(JSON.stringify(sanitizedPlan), new Date().toISOString());
    });

    tx();
    res.json({ ok: true, importedRsvps: sanitizedRsvps.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get(['/admin.html', '/visual.html', '/day-of.html', '/staff.html'], requireAdmin);
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/index.html', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login.html', (_req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.use(express.static(__dirname));

app.listen(PORT, () => {
  console.log(`wedding-table-planner listening on :${PORT}`);
});
