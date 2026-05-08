const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

const PORT = 19090 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
let child;
let cookie = '';

function request(path, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = http.request(`${BASE}${path}`, {
      method,
      headers: {
        ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text,
          json: () => JSON.parse(text),
        });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const res = await request('/health');
      if (res.status === 200) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('server did not start');
}

test.before(async () => {
  child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      ADMIN_USER: 'admin',
      ADMIN_PASS: 'changeme',
      SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
      DB_PATH: `/tmp/wtp-test-${PORT}.db`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => process.stdout.write(`[server] ${chunk}`));
  child.stderr.on('data', chunk => process.stderr.write(`[server] ${chunk}`));
  await waitForServer();
});

test.after(() => {
  if (child) child.kill('SIGTERM');
});

test('sensitive files are not served statically', async () => {
  for (const path of ['/data/wedding.db', '/server.js', '/.git/config', '/package.json', '/package-lock.json', '/Dockerfile', '/docker-compose.yml']) {
    const res = await request(path);
    assert.equal(res.status, 404, `${path} should be blocked`);
  }
});

test('admin API requires authentication', async () => {
  const res = await request('/api/plan');
  assert.equal(res.status, 401);
});

test('admin login works with configured credentials', async () => {
  const bad = await request('/auth/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } });
  assert.equal(bad.status, 401);

  const ok = await request('/auth/login', { method: 'POST', body: { username: 'admin', password: 'changeme' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json().ok, true);
  cookie = ok.headers['set-cookie'][0].split(';')[0];
  assert.ok(cookie.includes('wtp.sid='));
});

test('multiple named plans can be created and activated', async () => {
  const listBefore = await request('/api/plans', { headers: { cookie } });
  assert.equal(listBefore.status, 200);
  const beforeData = listBefore.json();
  assert.ok(beforeData.plans.length >= 1);
  const initialActive = beforeData.activePlanId;

  const create = await request('/api/plans', {
    method: 'POST',
    body: { name: 'Plan test', sourcePlanId: initialActive },
    headers: { cookie },
  });
  assert.equal(create.status, 200);
  const created = create.json();
  assert.equal(created.plan.name, 'Plan test');
  assert.equal(created.activePlanId, created.plan.id);

  const listAfter = await request('/api/plans', { headers: { cookie } });
  assert.equal(listAfter.status, 200);
  assert.ok(listAfter.json().plans.some(p => p.id === created.plan.id && p.active));

  const activate = await request(`/api/plans/${encodeURIComponent(initialActive)}/activate`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(activate.status, 200);
  assert.equal(activate.json().activePlanId, initialActive);
});

test('sanitizePlan removes root guests already seated at a table', async () => {
  const duplicateGuest = { id: 'guest-1', name: 'Camille Test', type: 'adulte' };
  const plan = {
    guests: [duplicateGuest, { id: 'guest-2', name: 'Alex Libre', type: 'adulte' }],
    tables: [{ id: 'table-1', name: 'Table 1', capacity: 8, guests: [duplicateGuest] }],
    layout: { tables: {}, guests: {} },
  };

  const save = await request('/api/plan', {
    method: 'POST',
    body: plan,
    headers: { cookie },
  });
  assert.equal(save.status, 200);

  const read = await request('/api/plan', { headers: { cookie } });
  assert.equal(read.status, 200);
  const data = read.json();
  assert.deepEqual(data.guests.map(g => g.id), ['guest-2']);
  assert.equal(data.tables[0].guests.length, 1);
  assert.equal(data.tables[0].guests[0].id, 'guest-1');
});
