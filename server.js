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

function buildCardHtml(table, themeName = 'theme-nude') {
  const guests = (table.guests || []).filter(Boolean).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base' }));
  const count = guests.length;
  const classes = [
    'place-card',
    themeName,
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
        --card-bg-start:#fdf6ef; --card-bg-end:#ebd9c8; --title-color:#ab7b4c; --accent-line:#bb8d67; --label-color:#8a6446;
        --frame-color:rgba(191,150,115,.18); --ornament-top:rgba(191,150,115,.16); --ornament-bottom:rgba(173,129,98,.10); --overlay-highlight:rgba(255,255,255,.22);
        position:relative; width:1000px; height:1500px; padding:86px 78px 68px; box-sizing:border-box; overflow:hidden;
        background: linear-gradient(180deg, var(--card-bg-start), var(--card-bg-end)); border:0; display:flex; isolation:isolate;
        font-family: Georgia, 'Times New Roman', serif;
      }
      .place-card::before {
        content:''; position:absolute; inset:0;
        background: radial-gradient(circle at 82% 12%, var(--ornament-top), transparent 18%), radial-gradient(circle at 16% 88%, var(--ornament-bottom), transparent 20%), linear-gradient(180deg, var(--overlay-highlight), transparent 18%);
        pointer-events:none; z-index:0;
      }
      .theme-nude { --card-bg-start:#fdf6ef; --card-bg-end:#ebd9c8; --title-color:#ab7b4c; --accent-line:#bb8d67; --label-color:#8a6446; --frame-color:rgba(191,150,115,.18); --ornament-top:rgba(191,150,115,.16); --ornament-bottom:rgba(173,129,98,.10); }
      .theme-sand { --card-bg-start:#fbf4eb; --card-bg-end:#decbb6; --title-color:#9d6f4c; --accent-line:#b38864; --label-color:#7d5f49; --frame-color:rgba(176,140,108,.2); --ornament-top:rgba(188,150,112,.18); --ornament-bottom:rgba(154,117,83,.12); }
      .theme-blush { --card-bg-start:#fbf0f0; --card-bg-end:#e6c7ca; --title-color:#b06f7e; --accent-line:#c68e98; --label-color:#8f5f68; --frame-color:rgba(190,132,142,.22); --ornament-top:rgba(202,146,156,.18); --ornament-bottom:rgba(177,120,129,.12); }
      .theme-linen { --card-bg-start:#f8f2ea; --card-bg-end:#d8c8b8; --title-color:#9a775f; --accent-line:#b59278; --label-color:#7b624f; --frame-color:rgba(179,146,114,.2); --ornament-top:rgba(188,156,126,.18); --ornament-bottom:rgba(152,122,94,.12); }
      .theme-clay { --card-bg-start:#f8ece5; --card-bg-end:#d9b49d; --title-color:#a45f43; --accent-line:#bc7d60; --label-color:#824f3c; --frame-color:rgba(181,116,88,.22); --ornament-top:rgba(191,126,98,.18); --ornament-bottom:rgba(165,97,69,.12); }
      .theme-champagne { --card-bg-start:#fbf7eb; --card-bg-end:#e4d1a8; --title-color:#b58a3c; --accent-line:#caab63; --label-color:#866b3e; --frame-color:rgba(196,164,89,.24); --ornament-top:rgba(212,180,98,.18); --ornament-bottom:rgba(173,143,69,.12); }
      .theme-ivory { --card-bg-start:#fffdf8; --card-bg-end:#e7ddcf; --title-color:#8f765c; --accent-line:#ac937b; --label-color:#6f6255; --frame-color:rgba(172,147,123,.18); --ornament-top:rgba(195,172,145,.16); --ornament-bottom:rgba(158,135,111,.10); }
      .theme-rosewater { --card-bg-start:#fcf1f3; --card-bg-end:#e9c8d3; --title-color:#b56f8e; --accent-line:#cb8fad; --label-color:#8d5d72; --frame-color:rgba(198,136,167,.22); --ornament-top:rgba(212,149,179,.18); --ornament-bottom:rgba(177,117,145,.12); }
      .theme-sage { --card-bg-start:#f2f6ef; --card-bg-end:#cad7c1; --title-color:#708261; --accent-line:#91a37f; --label-color:#59694d; --frame-color:rgba(125,145,108,.22); --ornament-top:rgba(144,165,126,.18); --ornament-bottom:rgba(104,127,89,.12); }
      .theme-olive { --card-bg-start:#f3f2ea; --card-bg-end:#d2cfb1; --title-color:#7c7a46; --accent-line:#9f9a62; --label-color:#615f3b; --frame-color:rgba(143,139,86,.22); --ornament-top:rgba(160,157,99,.18); --ornament-bottom:rgba(120,116,65,.12); }
      .theme-eucalyptus { --card-bg-start:#eef6f2; --card-bg-end:#bfd8ce; --title-color:#4f8371; --accent-line:#73aa96; --label-color:#44685b; --frame-color:rgba(98,149,128,.22); --ornament-top:rgba(114,170,147,.18); --ornament-bottom:rgba(76,128,109,.12); }
      .theme-forest-mist { --card-bg-start:#eef3ef; --card-bg-end:#bccbbd; --title-color:#5f765f; --accent-line:#7e9880; --label-color:#4f6150; --frame-color:rgba(112,140,114,.22); --ornament-top:rgba(130,157,132,.18); --ornament-bottom:rgba(92,115,94,.12); }
      .theme-dusty-blue { --card-bg-start:#eff5fb; --card-bg-end:#c7d7e6; --title-color:#6486a8; --accent-line:#86a8cb; --label-color:#536d86; --frame-color:rgba(111,145,180,.22); --ornament-top:rgba(132,167,203,.18); --ornament-bottom:rgba(91,121,151,.12); }
      .theme-powder-blue { --card-bg-start:#f2f8fd; --card-bg-end:#d4e3f1; --title-color:#7395b8; --accent-line:#94b5d5; --label-color:#5b7591; --frame-color:rgba(128,165,199,.2); --ornament-top:rgba(149,184,214,.18); --ornament-bottom:rgba(107,140,171,.12); }
      .theme-slate-blue { --card-bg-start:#f0f3fb; --card-bg-end:#c8d0e6; --title-color:#6879a0; --accent-line:#8797bf; --label-color:#55617f; --frame-color:rgba(111,126,171,.22); --ornament-top:rgba(136,152,191,.18); --ornament-bottom:rgba(92,106,144,.12); }
      .theme-french-blue { --card-bg-start:#eef5fc; --card-bg-end:#bfd6ef; --title-color:#4f79ac; --accent-line:#729fd5; --label-color:#486586; --frame-color:rgba(92,132,183,.22); --ornament-top:rgba(114,161,214,.18); --ornament-bottom:rgba(79,115,157,.12); }
      .theme-lavender { --card-bg-start:#f4f0fb; --card-bg-end:#d9cceb; --title-color:#8770a8; --accent-line:#a68bc9; --label-color:#6c5b86; --frame-color:rgba(145,123,178,.22); --ornament-top:rgba(166,142,201,.18); --ornament-bottom:rgba(122,103,154,.12); }
      .theme-mauve { --card-bg-start:#f7f0f6; --card-bg-end:#ddc3db; --title-color:#946483; --accent-line:#b884ab; --label-color:#765369; --frame-color:rgba(164,112,149,.22); --ornament-top:rgba(183,132,170,.18); --ornament-bottom:rgba(142,95,130,.12); }
      .theme-lilac { --card-bg-start:#f7f3fd; --card-bg-end:#ddd1f1; --title-color:#8b77b5; --accent-line:#ab95d5; --label-color:#705f92; --frame-color:rgba(145,125,189,.22); --ornament-top:rgba(170,149,213,.18); --ornament-bottom:rgba(120,104,157,.12); }
      .theme-peach { --card-bg-start:#fdf1e6; --card-bg-end:#f0c9b0; --title-color:#c57d4f; --accent-line:#dd9b6a; --label-color:#965f40; --frame-color:rgba(201,133,87,.22); --ornament-top:rgba(219,153,104,.18); --ornament-bottom:rgba(186,112,69,.12); }
      .theme-apricot { --card-bg-start:#fbf1e9; --card-bg-end:#ebccb2; --title-color:#bb8357; --accent-line:#d29d74; --label-color:#936647; --frame-color:rgba(193,141,97,.22); --ornament-top:rgba(208,158,116,.18); --ornament-bottom:rgba(176,122,79,.12); }
      .theme-coral { --card-bg-start:#fcf0ec; --card-bg-end:#ecbdb5; --title-color:#c1695b; --accent-line:#d88c7f; --label-color:#95584e; --frame-color:rgba(197,112,97,.22); --ornament-top:rgba(214,141,129,.18); --ornament-bottom:rgba(185,102,90,.12); }
      .theme-terracotta { --card-bg-start:#f8ece7; --card-bg-end:#d89e87; --title-color:#b65e41; --accent-line:#ce7b5d; --label-color:#874938; --frame-color:rgba(185,102,74,.22); --ornament-top:rgba(206,122,91,.18); --ornament-bottom:rgba(168,91,67,.12); }
      .theme-rust { --card-bg-start:#f7ece7; --card-bg-end:#cf9887; --title-color:#a4543e; --accent-line:#bf755d; --label-color:#7f4333; --frame-color:rgba(168,91,69,.24); --ornament-top:rgba(190,117,95,.18); --ornament-bottom:rgba(149,78,60,.12); }
      .theme-cinnamon { --card-bg-start:#f8f1ec; --card-bg-end:#d8b5a2; --title-color:#986248; --accent-line:#b87f62; --label-color:#754c3a; --frame-color:rgba(154,103,79,.22); --ornament-top:rgba(185,127,98,.18); --ornament-bottom:rgba(136,91,70,.12); }
      .theme-espresso { --card-bg-start:#efe5df; --card-bg-end:#b79282; --title-color:#6d473a; --accent-line:#8d6657; --label-color:#553a31; --frame-color:rgba(117,79,64,.24); --ornament-top:rgba(145,102,84,.16); --ornament-bottom:rgba(103,69,57,.10); }
      .theme-charcoal { --card-bg-start:#f0efef; --card-bg-end:#c7c2c0; --title-color:#5f5753; --accent-line:#7d736f; --label-color:#4e4845; --frame-color:rgba(104,97,95,.22); --ornament-top:rgba(124,116,113,.14); --ornament-bottom:rgba(88,82,79,.10); }
      .theme-minimal-black { --card-bg-start:#f5f5f3; --card-bg-end:#d6d2ce; --title-color:#292624; --accent-line:#5f5752; --label-color:#46403c; --frame-color:rgba(52,47,44,.22); --ornament-top:rgba(95,87,82,.12); --ornament-bottom:rgba(54,49,46,.08); }
      .theme-gold-foil { --card-bg-start:#fbf7eb; --card-bg-end:#dfc27d; --title-color:#a67a19; --accent-line:#d7b04f; --label-color:#7b6223; --frame-color:rgba(184,145,67,.24); --ornament-top:rgba(214,177,78,.18); --ornament-bottom:rgba(160,122,44,.12); }
      .theme-garden-party { --card-bg-start:#f2f8ef; --card-bg-end:#c7dcb2; --title-color:#658a56; --accent-line:#86b075; --label-color:#4f6a45; --frame-color:rgba(113,156,92,.22); --ornament-top:rgba(136,176,115,.18); --ornament-bottom:rgba(96,128,79,.12); }
      .theme-modern-serif { --card-bg-start:#faf8f4; --card-bg-end:#d8d0c7; --title-color:#655b54; --accent-line:#8a7c72; --label-color:#564d47; --frame-color:rgba(109,97,88,.2); --ornament-top:rgba(138,124,114,.16); --ornament-bottom:rgba(103,92,84,.10); }

      .card-frame { position:absolute; inset:40px; border-radius:22px; border:1px solid var(--frame-color); }
      .card-frame::before, .card-frame::after { content:''; position:absolute; width:22px; height:22px; border:1px solid color-mix(in srgb, var(--frame-color) 140%, white 0%); border-radius:50%; background:rgba(255,255,255,.3); }
      .card-frame::before { top:-11px; left:calc(50% - 11px); }
      .card-frame::after { bottom:-11px; left:calc(50% - 11px); }
      .print-safe-area { position:absolute; inset:88px; border:1px dashed var(--frame-color); border-radius:18px; }
      .botanical, .botanical-bottom { position:absolute; pointer-events:none; z-index:0; opacity:.72; }
      .botanical { right:-8px; top:-2px; width:138px; height:210px; }
      .botanical-bottom { left:-10px; bottom:-8px; width:146px; height:220px; transform: scaleX(-1) rotate(-8deg); opacity:.54; }
      .card-inner { position:relative; z-index:1; display:flex; flex-direction:column; min-height:100%; width:100%; }
      .card-eyebrow { text-align:center; color: color-mix(in srgb, var(--label-color) 82%, white 18%); text-transform:uppercase; letter-spacing:.28em; font-size:13px; font-weight:700; margin-bottom:10px; }
      .card-title { margin:2px 0 4px; font-size:64px; line-height:.95; text-align:center; color:var(--title-color); font-style:italic; font-weight:600; }
      .card-divider { width:74px; height:1px; margin:8px auto 18px; background: linear-gradient(90deg, transparent, var(--accent-line), transparent); }
      .guest-list { display:grid; gap:8px; margin-top:18px; align-content:start; align-self:stretch; flex:1; height:100%; }
      .guest-item { text-align:center; color:#5c4332; font-size:20px; line-height:1.12; font-weight:600; padding:2px 0; }
      .has-few-guests .guest-list { align-content:center; gap:14px; }
      .has-few-guests .guest-item { font-size:28px; line-height:1.08; }
      .has-medium-guests .guest-list { align-content:center; gap:10px; }
      .has-medium-guests .guest-item { font-size:24px; line-height:1.1; }
      .is-dense { padding:76px 70px 58px; }
      .is-dense .card-title { font-size:54px; }
      .is-dense .guest-list { margin-top:14px; gap:7px; }
      .is-dense .guest-item { font-size:18px; line-height:1.1; }
      .is-very-dense { padding:66px 62px 50px; }
      .is-very-dense .card-frame { inset:32px; }
      .is-very-dense .card-title { font-size:44px; }
      .is-very-dense .guest-list { margin-top:10px; gap:5px; }
      .is-very-dense .guest-item { font-size:15px; line-height:1.04; }
      .is-two-columns .guest-list { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap:10px; row-gap:6px; }
      .is-two-columns .guest-item { font-size:15px; line-height:1.05; }
      .card-footer { margin-top:auto; padding-top:14px; text-align:center; color: color-mix(in srgb, var(--label-color) 82%, white 18%); font-size:10px; letter-spacing:.22em; text-transform:uppercase; }
    </style>
  </head>
  <body>
    <article class="${classes}">
      <svg class="botanical" viewBox="0 0 180 260" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M68 248C74 213 78 181 77 149C76 121 67 92 48 63" stroke="#B88D66" stroke-width="2.2" stroke-linecap="round" opacity=".55"/><path d="M80 231C102 201 112 171 112 136C112 104 103 73 84 44" stroke="#9A6F4E" stroke-width="1.9" stroke-linecap="round" opacity=".45"/><path d="M41 86C26 83 16 72 12 54C27 58 38 66 45 80" fill="#DAB9A1" opacity=".7"/><path d="M34 118C18 117 8 109 3 93C20 96 31 104 38 113" fill="#E6CAB7" opacity=".62"/><path d="M98 62C112 55 121 42 124 24C111 28 100 37 94 51" fill="#C89A72" opacity=".58"/><path d="M120 104C136 98 146 85 150 68C135 72 124 82 117 95" fill="#D9B296" opacity=".55"/><circle cx="85" cy="40" r="10" fill="#E7D0BF" opacity=".65"/><circle cx="49" cy="78" r="8" fill="#E2C3AD" opacity=".56"/><circle cx="117" cy="92" r="8" fill="#D1A684" opacity=".52"/><circle cx="25" cy="110" r="7" fill="#EAD6C7" opacity=".58"/></svg>
      <svg class="botanical-bottom" viewBox="0 0 180 260" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M68 248C74 213 78 181 77 149C76 121 67 92 48 63" stroke="#B88D66" stroke-width="2.2" stroke-linecap="round" opacity=".55"/><path d="M80 231C102 201 112 171 112 136C112 104 103 73 84 44" stroke="#9A6F4E" stroke-width="1.9" stroke-linecap="round" opacity=".45"/><path d="M41 86C26 83 16 72 12 54C27 58 38 66 45 80" fill="#DAB9A1" opacity=".7"/><path d="M34 118C18 117 8 109 3 93C20 96 31 104 38 113" fill="#E6CAB7" opacity=".62"/><path d="M98 62C112 55 121 42 124 24C111 28 100 37 94 51" fill="#C89A72" opacity=".58"/><path d="M120 104C136 98 146 85 150 68C135 72 124 82 117 95" fill="#D9B296" opacity=".55"/><circle cx="85" cy="40" r="10" fill="#E7D0BF" opacity=".65"/><circle cx="49" cy="78" r="8" fill="#E2C3AD" opacity=".56"/><circle cx="117" cy="92" r="8" fill="#D1A684" opacity=".52"/><circle cx="25" cy="110" r="7" fill="#EAD6C7" opacity=".58"/></svg>
      <div class="card-frame"></div>
      <div class="print-safe-area"></div>
      <div class="card-inner">
        <div class="card-eyebrow">Mariage</div>
        <div class="card-title">${escapeHtml(table.name || 'Table')}</div>
        <div class="card-divider"></div>
        <div class="guest-list">${guestHtml}</div>
        <div class="card-footer">Avec amour & célébration</div>
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

    const chromiumPath = findChromiumBinary();
    if (!chromiumPath) {
      return res.status(500).json({ ok: false, error: 'Chromium introuvable sur le serveur pour l’export cartes.' });
    }

    const tmpBase = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wtp-cards-'));
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
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/postcards/export.pdf', requireAdmin, (req, res) => {
  try {
    const theme = cleanText(req.query.theme || 'theme-nude', 80) || 'theme-nude';
    const chromiumPath = findChromiumBinary();
    if (!chromiumPath) {
      return res.status(500).json({ ok: false, error: 'Chromium introuvable sur le serveur pour générer le PDF cartes.' });
    }

    const tmpBase = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wtp-pdf-'));
    const htmlPath = path.join(tmpBase, 'cards.html');
    const pdfPath = path.join(tmpBase, 'cards.pdf');

    const planRow = db.prepare('SELECT data FROM plan WHERE id=1').get();
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
