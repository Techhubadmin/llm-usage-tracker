// usage.js - pull token counts out of provider responses (plain JSON or an SSE stream).
// Returns { input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, model? } or null.

export function usageFromJson(provider, json) {
  const u = json?.usage || json?.response?.usage;
  if (!u) return null;

  if (provider === 'anthropic') {
    // Anthropic reports uncached input separately from cache reads/writes.
    return {
      input_tokens: u.input_tokens || 0,
      output_tokens: u.output_tokens || 0,
      cache_read_tokens: u.cache_read_input_tokens || 0,
      cache_write_tokens: u.cache_creation_input_tokens || 0,
      model: json.model || json.response?.model,
    };
  }

  // OpenAI-style: prompt_tokens (chat) or input_tokens (responses API) INCLUDE cached tokens.
  const cached = u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens ?? 0;
  const input = u.prompt_tokens ?? u.input_tokens ?? 0;
  return {
    input_tokens: Math.max(0, input - cached),
    output_tokens: u.completion_tokens ?? u.output_tokens ?? 0,
    cache_read_tokens: cached,
    cache_write_tokens: 0,
    model: json.model || json.response?.model,
  };
}

export function usageFromSse(provider, text) {
  const acc = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, model: undefined };
  let found = false;

  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;

    let ev;
    try { ev = JSON.parse(payload); } catch { continue; }

    if (provider === 'anthropic') {
      // message_start carries input + cache counts; message_delta carries the final output count.
      const u = ev.type === 'message_start' ? ev.message?.usage : ev.type === 'message_delta' ? ev.usage : null;
      if (!u) continue;
      if (u.input_tokens != null) acc.input_tokens = u.input_tokens;
      if (u.output_tokens != null) acc.output_tokens = u.output_tokens;
      if (u.cache_read_input_tokens != null) acc.cache_read_tokens = u.cache_read_input_tokens;
      if (u.cache_creation_input_tokens != null) acc.cache_write_tokens = u.cache_creation_input_tokens;
      if (ev.message?.model) acc.model = ev.message.model;
      found = true;
    } else {
      // OpenAI: the final chat chunk (with stream_options.include_usage) or response.completed.
      const u = usageFromJson(provider, ev);
      if (!u) continue;
      Object.assign(acc, u, { model: u.model || acc.model });
      found = true;
    }
  }
  return found ? acc : null;
}
