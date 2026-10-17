'use strict';
// Padelzeit Post-Abstimmung: liefert die Seite aus public/ und eine kleine JSON-API.
// Keine Abhängigkeiten. Stimmen und Kommentare liegen in DATA_DIR/db.json –
// auf Railway ein Volume einhängen, sonst ist bei jedem Deploy alles weg.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const APP_PASSWORD = process.env.APP_PASSWORD || '';

const LIMITS = { name: 40, comment: 280, client: 64, body: 8 * 1024 };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'posts.json'), 'utf8'));
const POST_IDS = manifest.posts.map((p) => p.id);
const POST_SET = new Set(POST_IDS);

// ---------- Speicher ----------

function loadDb() {
  const empty = { votes: {}, comments: {}, status: {} };
  let raw;
  try {
    raw = fs.readFileSync(DB_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return empty;
    throw err;
  }
  try {
    return { ...empty, ...JSON.parse(raw) };
  } catch (err) {
    // Kaputte Datei nicht überschreiben, sondern beiseitelegen
    const backup = `${DB_FILE}.kaputt-${Date.now()}`;
    fs.renameSync(DB_FILE, backup);
    console.error(`db.json war nicht lesbar (${err.message}), gesichert als ${backup}`);
    return empty;
  }
}

const db = loadDb();
let saveTimer = null;

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    console.error('Speichern fehlgeschlagen:', err);
  }
}

function scheduleSave() {
  if (!saveTimer) saveTimer = setTimeout(saveNow, 150);
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (saveTimer) saveNow();
    process.exit(0);
  });
}

// ---------- Hilfen ----------

function clean(value, max, multiline = false) {
  let s = String(value ?? '').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ');
  s = multiline ? s.replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
  return s.trim().slice(0, max);
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > LIMITS.body) {
        req.pause();
        reject(Object.assign(new Error('Anfrage zu groß'), { status: 413 }));
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function authorized(req) {
  if (!APP_PASSWORD) return true;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const given = decoded.slice(decoded.indexOf(':') + 1);
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(APP_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

// ---------- API ----------

function stateFor(clientId) {
  const posts = {};
  for (const id of POST_IDS) {
    const votes = db.votes[id] || {};
    const yes = [];
    const no = [];
    for (const v of Object.values(votes)) (v.value > 0 ? yes : no).push(v.name);
    const status = db.status[id];
    posts[id] = {
      yes,
      no,
      mine: votes[clientId] ? votes[clientId].value : 0,
      status: status ? { state: status.state, name: status.name, ts: status.ts } : null,
      comments: (db.comments[id] || []).map((c) => ({
        id: c.id,
        name: c.name,
        text: c.text,
        ts: c.ts,
        mine: c.client === clientId,
      })),
    };
  }
  return { posts };
}

// Namensänderung auf alle bisherigen Stimmen und Kommentare dieses Geräts übertragen
function renameClient(clientId, name) {
  for (const votes of Object.values(db.votes)) if (votes[clientId]) votes[clientId].name = name;
  for (const list of Object.values(db.comments)) for (const c of list) if (c.client === clientId) c.name = name;
  for (const s of Object.values(db.status)) if (s.client === clientId) s.name = name;
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/state') {
    return sendJson(res, 200, stateFor(clean(url.searchParams.get('client'), LIMITS.client)));
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Methode nicht erlaubt' });
  // Nur JSON annehmen – schützt vor fremden Formular-Posts (CSRF)
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    return sendJson(res, 415, { error: 'Nur JSON' });
  }

  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    res.setHeader('Connection', 'close');
    return sendJson(res, err.status || 400, { error: err.status ? err.message : 'Ungültige Anfrage' });
  }

  const clientId = clean(body.clientId, LIMITS.client);
  const name = clean(body.name, LIMITS.name);
  if (!clientId || !name) return sendJson(res, 400, { error: 'Name fehlt' });

  const postId = String(body.postId || '');
  const needsPost = url.pathname !== '/api/rename';
  if (needsPost && !POST_SET.has(postId)) return sendJson(res, 400, { error: 'Unbekannter Post' });

  switch (url.pathname) {
    case '/api/vote': {
      const value = Number(body.value);
      if (![1, -1, 0].includes(value)) return sendJson(res, 400, { error: 'Ungültige Stimme' });
      const votes = (db.votes[postId] ||= {});
      if (value === 0) delete votes[clientId];
      else votes[clientId] = { value, name, ts: Date.now() };
      break;
    }
    case '/api/comment': {
      const text = clean(body.text, LIMITS.comment, true);
      if (!text) return sendJson(res, 400, { error: 'Kommentar ist leer' });
      (db.comments[postId] ||= []).push({ id: crypto.randomUUID(), client: clientId, name, text, ts: Date.now() });
      break;
    }
    case '/api/comment/delete': {
      const list = db.comments[postId] || [];
      const index = list.findIndex((c) => c.id === body.commentId && c.client === clientId);
      if (index < 0) return sendJson(res, 404, { error: 'Kommentar nicht gefunden' });
      list.splice(index, 1);
      break;
    }
    case '/api/status': {
      // gepostet / gelöscht (landet im Papierkorb) / wieder offen – für alle sichtbar
      const value = String(body.state || '');
      if (!['posted', 'deleted', 'open'].includes(value)) return sendJson(res, 400, { error: 'Unbekannter Status' });
      if (value === 'open') delete db.status[postId];
      else db.status[postId] = { state: value, name, client: clientId, ts: Date.now() };
      break;
    }
    case '/api/rename':
      break;
    default:
      return sendJson(res, 404, { error: 'Unbekannte Aktion' });
  }

  renameClient(clientId, name);
  scheduleSave();
  return sendJson(res, 200, stateFor(clientId));
}

// ---------- Statische Dateien ----------

function serveStatic(req, res, url) {
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      // Bilder ändern sich nur mit einem neuen Deploy; Seite und Skripte immer frisch prüfen
      'Cache-Control': ext === '.jpg' ? 'public, max-age=86400' : 'no-cache',
    });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
  });
}

// ---------- Server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }
  if (!authorized(req)) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="Padelzeit Posts", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
    });
    res.end('Passwort erforderlich');
    return;
  }
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
    else res.writeHead(405).end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: 'Serverfehler' });
  }
});

server.listen(PORT, () => {
  console.log(`Padelzeit Post-Abstimmung läuft auf http://localhost:${PORT}`);
  console.log(`Daten: ${DB_FILE}${APP_PASSWORD ? ' · Passwortschutz an' : ''}`);
});
