# LLM Usage Tracker

One small Node server that records every LLM API call (tokens, cost, latency, project) in a
local SQLite file and shows it in a plain dashboard. No dependencies, no build step.

```
npm start          # http://localhost:4141
npm run seed       # optional: 30 days of demo data so you can see the UI
```

Needs Node 22.5 or newer (uses the built-in `node:sqlite`).

## How calls get recorded

**1. Proxy (no code changes).** Point your SDK at the tracker; it forwards the request to the
real API, streams the answer back untouched, and records the usage from the response.

```bash
ANTHROPIC_BASE_URL=http://localhost:4141/proxy/anthropic
OPENAI_BASE_URL=http://localhost:4141/proxy/openai/v1
```

Both streaming and non-streaming calls are handled. Your API key passes straight through and
is never stored. Tag calls with a project by adding a header:

```python
client = anthropic.Anthropic(default_headers={"x-llm-project": "chatbot"})
```

Without a header, the `LLM_PROJECT` environment variable is used, then `"default"`.

**2. Direct log.** For anything that cannot go through the proxy, post the numbers:

```bash
curl -X POST http://localhost:4141/api/log -H "content-type: application/json" \
  -d '{"model":"claude-opus-5","project":"batch-job","input_tokens":1200,"output_tokens":300}'
```

You can also post `{"model": "...", "usage": <the raw usage object from the response>}` and
the tracker will read the provider's field names for you.

## Pricing

Costs come from `pricing.json`: USD per million tokens, keyed by model-id prefix (longest match
wins, so `gpt-4o` also covers `gpt-4o-2024-08-06`). Anthropic and OpenAI models are filled in,
with the fetch date noted in the file. Add anything else there; until you do, those calls show as
**no price** in the UI rather than as $0. Restart the server after editing.

## API

| Route | What it returns |
|---|---|
| `GET /api/summary?range=today\|7d\|30d\|all` | totals, per-day series, by model, by project |
| `GET /api/events?limit=50` | most recent calls |
| `POST /api/log` | record one call |
| `GET /api/export.csv` | every row as CSV |
| `GET /api/pricing` | the pricing table in use |

## Files

```
server.js        routes: dashboard, API, proxy
src/store.js     SQLite schema, pricing lookup, queries
src/usage.js     reads token counts from JSON or SSE responses
src/proxy.js     forwards to the provider and records the result
public/index.html  the dashboard (vanilla HTML/JS, one file)
pricing.json     editable price table
usage.db         created on first run (set DB_PATH to move it)
```
