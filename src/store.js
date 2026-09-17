// store.js - SQLite storage, pricing lookup, and the read queries the UI needs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'usage.db');

export const pricing = JSON.parse(fs.readFileSync(path.join(ROOT, 'pricing.json'), 'utf8'));

export const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS usage (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    ts                 TEXT    NOT NULL,              -- ISO 8601, UTC
    provider           TEXT    NOT NULL,              -- anthropic | openai | other
    model              TEXT    NOT NULL,
    project            TEXT    NOT NULL DEFAULT 'default',
    input_tokens       INTEGER NOT NULL DEFAULT 0,    -- uncached input
    output_tokens      INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd           REAL    NOT NULL DEFAULT 0,
    priced             INTEGER NOT NULL DEFAULT 1,    -- 0 when the model has no entry in pricing.json
    latency_ms         INTEGER,
    status             INTEGER,                       -- HTTP status from the provider
    streamed           INTEGER NOT NULL DEFAULT 0,
    source             TEXT    NOT NULL DEFAULT 'proxy' -- proxy | api
  );
  CREATE INDEX IF NOT EXISTS usage_ts ON usage(ts);
`);

// ---- pricing -------------------------------------------------------------

export function priceFor(model) {
  let best = null;
  for (const key of Object.keys(pricing)) {
    if (key.startsWith('_')) continue;
    if (model.startsWith(key) && (!best || key.length > best.length)) best = key;
  }
  return best ? pricing[best] : null;
}

export function costOf(model, u) {
  const p = priceFor(model);
  if (!p) return null;
  const per = (tokens, rate) => ((tokens || 0) * (rate || 0)) / 1e6;
  return (
    per(u.input_tokens, p.input) +
    per(u.output_tokens, p.output) +
    per(u.cache_read_tokens, p.cache_read ?? p.input * 0.1) +
    per(u.cache_write_tokens, p.cache_write ?? p.input * 1.25)
  );
}

// ---- write ---------------------------------------------------------------

const insert = db.prepare(`
  INSERT INTO usage (ts, provider, model, project, input_tokens, output_tokens,
                     cache_read_tokens, cache_write_tokens, cost_usd, priced,
                     latency_ms, status, streamed, source)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export function record(e) {
  const cost = costOf(e.model, e);
  insert.run(
    e.ts || new Date().toISOString(),
    e.provider || 'other',
    e.model || 'unknown',
    e.project || 'default',
    e.input_tokens | 0,
    e.output_tokens | 0,
    e.cache_read_tokens | 0,
    e.cache_write_tokens | 0,
    cost ?? 0,
    cost === null ? 0 : 1,
    e.latency_ms ?? null,
    e.status ?? null,
    e.streamed ? 1 : 0,
    e.source || 'proxy',
  );
}

// ---- read ----------------------------------------------------------------

const localDay = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function sinceFor(range) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const days = { today: 0, '7d': 6, '30d': 29, '90d': 89 }[range];
  if (days === undefined) {
    const first = db.prepare('SELECT MIN(ts) AS ts FROM usage').get().ts;
    return first ? new Date(first) : start;
  }
  start.setDate(start.getDate() - days);
  return start;
}

const SUMS = `
  COUNT(*)                                   AS requests,
  COALESCE(SUM(cost_usd), 0)                 AS cost,
  COALESCE(SUM(input_tokens), 0)             AS input_tokens,
  COALESCE(SUM(output_tokens), 0)            AS output_tokens,
  COALESCE(SUM(cache_read_tokens), 0)        AS cache_read_tokens,
  COALESCE(SUM(cache_write_tokens), 0)       AS cache_write_tokens,
  COALESCE(SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END), 0) AS errors,
  COALESCE(SUM(CASE WHEN priced = 0 THEN 1 ELSE 0 END), 0)    AS unpriced`;

export function summary(range) {
  const since = sinceFor(range);
  const iso = since.toISOString();

  const totals = db.prepare(`SELECT ${SUMS} FROM usage WHERE ts >= ?`).get(iso);

  const byModel = db
    .prepare(`SELECT provider, model, ${SUMS} FROM usage WHERE ts >= ? GROUP BY provider, model ORDER BY cost DESC`)
    .all(iso);

  const byProject = db
    .prepare(`SELECT project, ${SUMS} FROM usage WHERE ts >= ? GROUP BY project ORDER BY cost DESC`)
    .all(iso);

  // One row per calendar day (server local time), zero-filled so the chart has no gaps.
  const perDay = new Map(
    db
      .prepare(`SELECT date(ts, 'localtime') AS day, ${SUMS} FROM usage WHERE ts >= ? GROUP BY day`)
      .all(iso)
      .map((r) => [r.day, r]),
  );
  const byDay = [];
  const today = new Date();
  for (const d = new Date(since); d <= today; d.setDate(d.getDate() + 1)) {
    const day = localDay(d);
    byDay.push({ day, cost: 0, requests: 0, ...perDay.get(day) });
  }

  return { range, since: iso, totals, by_model: byModel, by_project: byProject, by_day: byDay };
}

export function recent(limit = 50) {
  return db.prepare('SELECT * FROM usage ORDER BY id DESC LIMIT ?').all(Math.min(limit | 0 || 50, 500));
}

export function allRows() {
  return db.prepare('SELECT * FROM usage ORDER BY id').all();
}
