// Serves the Orbit dashboard and implements Meta's webhook verification.
//
//   META_VERIFY_TOKEN=your-random-string META_APP_SECRET=your-app-secret node server.js
//
// Optional: PORT (default 4173), LOG_WEBHOOK_PAYLOADS=1 to print full event bodies.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env when present so `node server.js` picks up local settings.
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(path.join(__dirname, '.env'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[env] Could not load .env:', err.message);
  }
}

const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '127.0.0.1';
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || '';
const APP_SECRET = process.env.META_APP_SECRET || '';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || '';
const LOG_PAYLOADS = process.env.LOG_WEBHOOK_PAYLOADS === '1';

// Latest webhook events, exposed to the dashboard's notification panel.
const webhookEvents = [];
const MAX_EVENTS = 50;

const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};
const BLOCKED = new Set(['server.js', '.env', '.env.local']);

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  if (BLOCKED.has(relative) || relative.split('/').some((part) => part.startsWith('.'))) {
    return send(res, 404, 'Not found');
  }

  const filePath = path.resolve(ROOT, relative);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, 'index.html')) {
    return send(res, 403, 'Forbidden');
  }

  fs.readFile(filePath, function (err, data) {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, data, TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
  });
}

// GET: Meta's verification handshake. It must receive hub.challenge verbatim.
function verifyWebhook(url, res) {
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (!VERIFY_TOKEN) {
    console.error('[webhook] META_VERIFY_TOKEN is not set; cannot verify.');
    return send(res, 500, 'META_VERIFY_TOKEN is not configured on the server.');
  }

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[webhook] Verification succeeded; returning challenge.');
    return send(res, 200, challenge || '');
  }

  console.warn('[webhook] Verification failed (mode=%s, token match=%s).', mode, token === VERIFY_TOKEN);
  return send(res, 403, 'Verification failed');
}

function isConfigured(value) {
  return Boolean(value) && value.indexOf('replace-with') !== 0;
}

function summarizeValue(value, max) {
  let text;
  if (typeof value === 'string') text = value;
  else {
    try { text = JSON.stringify(value); } catch (err) { text = String(value); }
  }
  if (text == null) return '';
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

// Turns a Meta payload into field names plus their new values.
function summarizePayload(payload) {
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  return entries.map(function (entry) {
    const changes = (entry.changes || []).map(function (change) {
      return {
        field: (change && change.field) || 'unknown',
        value: summarizeValue(change && change.value, 500)
      };
    });
    const messages = (entry.messaging || []).map(function (event) {
      const field = event.message ? 'messages' : (event.postback ? 'messaging_postbacks' : 'messaging');
      const value = event.message ? event.message.text
        : (event.postback ? event.postback.payload : event);
      return { field: field, value: summarizeValue(value, 500) };
    });
    return {
      id: entry.id || null,
      time: entry.time || null,
      changes: changes.concat(messages)
    };
  });
}

function webhookStatusPayload() {
  const base = String(PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  return {
    verifyTokenConfigured: isConfigured(VERIFY_TOKEN),
    appSecretConfigured: isConfigured(APP_SECRET),
    publicBaseUrl: base || null,
    callbackUrl: base ? base + '/webhooks/meta' : null,
    events: webhookEvents.slice(0, 25)
  };
}

function handleEvent(req, res) {
  const chunks = [];
  let size = 0;

  req.on('data', function (chunk) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) {
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', function () {
    const raw = Buffer.concat(chunks);

    if (!APP_SECRET) {
      console.error('[webhook] META_APP_SECRET is not set; refusing unverified events.');
      return send(res, 500, 'META_APP_SECRET is not configured on the server.');
    }

    const signature = req.headers['x-hub-signature-256'] || '';
    const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex');
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    const valid = signatureBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

    if (!valid) {
      console.warn('[webhook] Invalid or missing X-Hub-Signature-256.');
      return send(res, 401, 'Invalid signature');
    }

    let payload;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch (err) {
      return send(res, 400, 'Invalid JSON');
    }

    if (LOG_PAYLOADS) {
      console.log('[webhook] payload', JSON.stringify(payload, null, 2));
    }

    const summary = summarizePayload(payload);
    webhookEvents.unshift({
      receivedAt: new Date().toISOString(),
      object: payload.object || 'unknown',
      entries: summary
    });
    if (webhookEvents.length > MAX_EVENTS) webhookEvents.length = MAX_EVENTS;

    summary.forEach(function (entry) {
      entry.changes.forEach(function (change) {
        console.log('[webhook] %s field "%s" = %s', payload.object || 'unknown', change.field, change.value);
      });
    });
    if (!summary.length) console.log('[webhook] %s event with no entries', payload.object || 'unknown');

    // Meta expects a fast 200; do the actual work asynchronously in production.
    send(res, 200, 'EVENT_RECEIVED');
  });
}

const server = http.createServer(function (req, res) {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));

  if (url.pathname === '/webhooks/meta') {
    if (req.method === 'GET') return verifyWebhook(url, res);
    if (req.method === 'POST') return handleEvent(req, res);
    return send(res, 405, 'Method not allowed');
  }

  if (url.pathname === '/webhooks/meta/events' && req.method === 'GET') {
    return send(res, 200, JSON.stringify({ events: webhookEvents.slice(0, 25) }),
      'application/json; charset=utf-8');
  }

  if (url.pathname === '/api/webhook-status' && req.method === 'GET') {
    return send(res, 200, JSON.stringify(webhookStatusPayload()), 'application/json; charset=utf-8');
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, function () {
  console.log('Dashboard:  http://' + HOST + ':' + PORT);
  console.log('Webhook:    http://' + HOST + ':' + PORT + '/webhooks/meta');
  console.log('Verify token configured: %s', VERIFY_TOKEN ? 'yes' : 'NO — set META_VERIFY_TOKEN');
  console.log('App secret configured:   %s', APP_SECRET ? 'yes' : 'NO — set META_APP_SECRET');
});
