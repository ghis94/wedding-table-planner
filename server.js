const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const helmet = require('helmet');
const { parse } = require('csv-parse/sync');

const app = express();
const PORT = process.env.PORT || 8090;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'wedding.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);

db.exec(`CREATE TABLE IF NOT EXISTS rsvps (
  id TEXT PRIMARY KEY,
  nom TEXT,
  prenom TEXT,
  presence TEXT,
  adultes INTEGER,
  enfants INTEGER,
  regime TEXT,
  message TEXT,
  createdAt TEXT
);
CREATE TABLE IF NOT EXISTS plan (
  id INTEGER PRIMARY KEY CHECK(id=1),
  data TEXT,
  updatedAt TEXT
);`);

app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

function basicAuth(req, res, next) {
  const hdr = req.headers.authorization || '';
  if (!hdr.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Auth required');
  }
  const decoded = Buffer.from(hdr.slice(6), 'base64').toString('utf8');
  const [u, p] = decoded.split(':');
  if (u === ADMIN_USER && p === ADMIN_PASS) return next();
  res.set('WWW-Authenticate', 'Basic realm="Admin"');
  return res.status(401).send('Invalid credentials');
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/rsvps', basicAuth, (_req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM rsvps ORDER BY datetime(createdAt) DESC').all();
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rsvp', (req, res) => {
  try {
    const b = req.body || {};
    const id = b.id || crypto.randomUUID();
    const stmt = db.prepare(`INSERT OR REPLACE INTO rsvps
      (id, nom, prenom, presence, adultes, enfants, regime, message, createdAt)
      VALUES (@id, @nom, @prenom, @presence, @adultes, @enfants, @regime, @message, @createdAt)`);
    stmt.run({
      id,
      nom: b.nom || '',
      prenom: b.prenom || '',
      presence: b.presence || '',
      adultes: Number(b.adultes || 0),
      enfants: Number(b.enfants || 0),
      regime: b.regime || '',
      message: b.message || '',
      createdAt: b.createdAt || new Date().toISOString(),
    });
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/plan', basicAuth, (_req, res) => {
  try {
    const row = db.prepare('SELECT data FROM plan WHERE id=1').get();
    const data = row?.data ? JSON.parse(row.data) : { tables: [], guests: [] };
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/plan', basicAuth, (req, res) => {
  try {
    const data = JSON.stringify(req.body || { tables: [], guests: [] });
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

app.post('/api/import-csv', basicAuth, (req, res) => {
  try {
    const csvText = req.body.csv || '';
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    const guests = records.map((r) => ({
      id: crypto.randomUUID(),
      name: [r.prenom || r.first_name || '', r.nom || r.last_name || ''].join(' ').trim() || r.name || 'Invité',
      type: ['enfant', 'child', 'kids', 'kid'].includes(String(r.type || '').toLowerCase()) ? 'enfant' : 'adulte',
      group: r.groupe || r.group || '',
    }));

    res.json({ ok: true, guests, count: guests.length });
  } catch (_e) {
    res.status(400).json({ ok: false, error: 'CSV invalide' });
  }
});

app.use('/admin.html', basicAuth);
app.use('/day-of.html', basicAuth);
app.use(express.static(__dirname));

app.listen(PORT, () => {
  console.log(`wedding-table-planner listening on :${PORT}`);
});