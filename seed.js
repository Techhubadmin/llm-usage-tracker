// seed.js - fill the database with 30 days of made-up usage so the dashboard has something to show.
//   node seed.js          (adds demo rows; safe to run more than once)
import { record, db } from './src/store.js';

const MODELS = [
  ['anthropic', 'claude-opus-5', 0.35],
  ['anthropic', 'claude-sonnet-5', 0.40],
  ['anthropic', 'claude-haiku-4-5', 0.20],
  ['anthropic', 'claude-fable-5-1', 0.05],
];
const PROJECTS = ['chatbot', 'summarizer', 'eval-runner', 'default'];

const pick = (weighted) => {
  let r = Math.random();
  for (const [a, b, w] of weighted) if ((r -= w) <= 0) return [a, b];
  return weighted[0];
};
const rand = (lo, hi) => Math.floor(lo + Math.random() * (hi - lo));

let n = 0;
for (let daysAgo = 29; daysAgo >= 0; daysAgo--) {
  const count = rand(8, 45);
  for (let i = 0; i < count; i++) {
    const [provider, model] = pick(MODELS);
    const ts = new Date();
    ts.setDate(ts.getDate() - daysAgo);
    ts.setHours(rand(8, 22), rand(0, 60), rand(0, 60), 0);
    if (ts > new Date()) continue;
    const failed = Math.random() < 0.03;
    record({
      ts: ts.toISOString(),
      provider,
      model,
      project: PROJECTS[rand(0, PROJECTS.length)],
      input_tokens: failed ? 0 : rand(300, 6000),
      output_tokens: failed ? 0 : rand(50, 1500),
      cache_read_tokens: failed || Math.random() < 0.5 ? 0 : rand(1000, 20000),
      latency_ms: rand(400, 9000),
      status: failed ? 429 : 200,
      streamed: Math.random() < 0.6,
      source: 'proxy',
    });
    n++;
  }
}
const total = db.prepare('SELECT COUNT(*) AS c FROM usage').get().c;
console.log(`Added ${n} demo rows (${total} rows total). Start the server and open http://localhost:4141`);
