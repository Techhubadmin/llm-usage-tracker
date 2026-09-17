// server.js - HTTP entry point: dashboard, JSON API, and the provider proxy.
//
//   node server.js                 -> http://localhost:4141
//   PORT=5000 node server.js
//
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { record, summary, recent, allRows, pricing } from './src/store.js';
import { proxy, readBody, UPSTREAMS } from './src/proxy.js';
import { usageFromJson } from './src/usage.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4141);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  try {
    // ---- proxy: /proxy/<provider>[/<project>]/v1/... ---------------------------
    // The optional segment before /v1 tags the call with a project name.
    const m = p.match(/^\/proxy\/(anthropic|openai)(?:\/([^/]+))?(\/v1\/.*)$/);
    if (m && UPSTREAMS[m[1]]) return await proxy(req, res, m[1], m[3] + url.search, m[2]);

    // ---- JSON API -----------------------------------------------------------
    if (p === '/api/summary') return json(res, summary(url.searchParams.get('range') || '7d'));
    if (p === '/api/events') return json(res, recent(Number(url.searchParams.get('limit')) || 50));
    if (p === '/api/pricing') return json(res, pricing);
    if (p === '/api/export.csv') return csv(res, allRows());
    if (p === '/api/log' && req.method === 'POST') return await logEvent(req, res);

    // ---- static dashboard ---------------------------------------------------
    return serveStatic(res, p === '/' ? '/index.html' : p);
  } catch (err) {
    console.error(err);
    json(res, { error: String(err.message || err) }, 500);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Is the tracker already running?`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`LLM usage tracker  ->  http://localhost:${PORT}`);
  console.log(`Anthropic proxy    ->  http://localhost:${PORT}/proxy/anthropic`);
  console.log(`OpenAI proxy       ->  http://localhost:${PORT}/proxy/openai/v1`);
});

// POST /api/log  { model, input_tokens, output_tokens, project?, provider?, ... }
// or             { model, project?, usage: <raw provider usage object> }
async function logEvent(req, res) {
  let body;
  try { body = JSON.parse((await readBody(req)).toString('utf8')); } catch { return json(res, { error: 'body must be JSON' }, 400); }
  if (!body?.model) return json(res, { error: '"model" is required' }, 400);

  const provider = body.provider || guessProvider(body.model);
  const fromRaw = body.usage ? usageFromJson(provider, body) : null;
  record({ ...body, ...fromRaw, provider, model: body.model, source: 'api' });
  json(res, { ok: true });
}

function guessProvider(model) {
  if (model.startsWith('claude')) return 'anthropic';
  if (/^(gpt|o\d|chatgpt|text-embedding)/.test(model)) return 'openai';
  return 'other';
}

// ---- helpers -----------------------------------------------------------------

function json(res, data, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

function csv(res, rows) {
  const cols = rows.length ? Object.keys(rows[0]) : ['id'];
  const cell = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))];
  res.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="llm-usage.csv"' });
  res.end(lines.join('\n'));
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
function serveStatic(res, urlPath) {
  const publicDir = path.join(ROOT, 'public');
  const file = path.join(publicDir, urlPath); // path.join resolves any ".." so the prefix check below is enough
  if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}
