const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const helmet = require('helmet');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { parse } = require('csv-parse/sync');

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

function sanitizeGuest(input = {}) {
  return {
    id: cleanText(input.id || crypto.randomUUID(), 80),
    name: cleanText(input.name || 'Invité', 160) || 'Invité',
    type: normalizeGuestType(input.type),
    rsvpStatus: normalizePresence(input.rsvpStatus),
    sourceRsvpId: cleanText(input.sourceRsvpId, 80),
    phone: cleanText(input.phone, 80),
    regime: cleanText(input.regime, 500),
    adminNotes: cleanText(input.adminNotes, 2000),
    adultes: clampInt(input.adultes, { min: 0, max: 20, fallback: 0 }),
    enfants: clampInt(input.enfants, { min: 0, max: 20, fallback: 0 }),
  };
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

app.get(['/admin.html', '/staff.html', '/visual.html', '/day-of.html'], requireAdmin);
app.get('/login.html', (_req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.use(express.static(__dirname));

app.listen(PORT, () => {
  console.log(`wedding-table-planner listening on :${PORT}`);
});