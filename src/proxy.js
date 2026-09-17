// proxy.js - forward a request to the provider, stream the answer back, record the usage.
import { record } from './store.js';
import { usageFromJson, usageFromSse } from './usage.js';

export const UPSTREAMS = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
};

export const PROJECT_HEADER = 'x-llm-project';

// Headers that must not be forwarded (hop-by-hop, or ones fetch manages itself).
const SKIP = new Set([
  'host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length', 'accept-encoding',
  PROJECT_HEADER,
]);

export async function proxy(req, res, provider, upstreamPath) {
  const started = Date.now();
  const project = req.headers[PROJECT_HEADER] || process.env.LLM_PROJECT || 'default';

  let body = await readBody(req);
  let reqJson = null;
  try { reqJson = JSON.parse(body.toString('utf8') || 'null'); } catch { /* not JSON, forward as-is */ }
  const streamed = Boolean(reqJson?.stream);

  // OpenAI chat completions only include usage on streams when asked for it.
  if (provider === 'openai' && streamed && upstreamPath.includes('/chat/completions')) {
    reqJson.stream_options = { ...(reqJson.stream_options || {}), include_usage: true };
    body = Buffer.from(JSON.stringify(reqJson));
  }

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!SKIP.has(k)) headers[k] = v;

  let upstream;
  try {
    upstream = await fetch(UPSTREAMS[provider] + upstreamPath, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    });
  } catch (err) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream unreachable', detail: String(err) }));
    return;
  }

  // Relay status + headers, then stream the body through while keeping a copy to parse.
  const outHeaders = {};
  upstream.headers.forEach((v, k) => {
    if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) outHeaders[k] = v;
  });
  res.writeHead(upstream.status, outHeaders);

  const chunks = [];
  if (upstream.body) {
    for await (const chunk of upstream.body) {
      res.write(chunk);
      chunks.push(chunk);
    }
  }
  res.end();

  const text = Buffer.concat(chunks).toString('utf8');
  const isSse = (upstream.headers.get('content-type') || '').includes('text/event-stream');
  let usage = null;
  if (isSse) usage = usageFromSse(provider, text);
  else { try { usage = usageFromJson(provider, JSON.parse(text)); } catch { /* no usage in body */ } }

  record({
    provider,
    model: usage?.model || reqJson?.model || 'unknown',
    project,
    ...usage,
    latency_ms: Date.now() - started,
    status: upstream.status,
    streamed,
    source: 'proxy',
  });
}

export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
