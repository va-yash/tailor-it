// ─────────────────────────────────────────────────────────────
// Shared helpers for all /api routes.
// Filename starts with "_" so Vercel does not expose it as a route.
// ─────────────────────────────────────────────────────────────

// ── MODEL CONFIG ──
// Split by job: Opus 5 writes the CV (quality matters), Sonnet 5 does the
// mechanical extraction/merging (40% of the cost, same accuracy on that task).
// Override per-environment without a code change by setting these env vars.
export const MODELS = {
  generate: process.env.GENERATE_MODEL || 'claude-opus-5',
  parse:    process.env.PARSE_MODEL    || 'claude-sonnet-5',
  bundle:   process.env.BUNDLE_MODEL   || 'claude-sonnet-5',
};

// Effort controls how much the model thinks before answering. Lower = cheaper.
export const EFFORT = {
  generate: process.env.GENERATE_EFFORT || 'medium',
  parse:    process.env.PARSE_EFFORT    || 'low',
  bundle:   process.env.BUNDLE_EFFORT   || 'low',
};

// ── PRICING (USD per 1M tokens) ──
// Cache writes cost ~1.25x input; cache reads ~0.1x input.
const PRICING = {
  'claude-opus-5':     { in: 5.00, out: 25.00 },
  'claude-opus-4-8':   { in: 5.00, out: 25.00 },
  'claude-sonnet-5':   { in: 2.00, out: 10.00 },
  'claude-sonnet-4-6': { in: 3.00, out: 15.00 },
  'claude-haiku-4-5':  { in: 1.00, out:  5.00 },
  'claude-fable-5':    { in:10.00, out: 50.00 },
};

/**
 * Turn a usage object from the API into a token + dollar breakdown.
 * Returns nulls for cost if we do not have pricing for that model, rather
 * than silently reporting $0 and making spend look free.
 */
export function costOf(model, usage) {
  const u = usage || {};
  const fresh     = u.input_tokens               || 0;
  const cacheRead = u.cache_read_input_tokens    || 0;
  const cacheWrite= u.cache_creation_input_tokens|| 0;
  const output    = u.output_tokens              || 0;
  const totalIn   = fresh + cacheRead + cacheWrite;

  const p = PRICING[model];
  const usd = p
    ? (fresh      * p.in  / 1e6)
    + (cacheWrite * p.in  * 1.25 / 1e6)
    + (cacheRead  * p.in  * 0.10 / 1e6)
    + (output     * p.out / 1e6)
    : null;

  return {
    model,
    inputTokens: fresh,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    outputTokens: output,
    totalTokens: totalIn + output,
    // How much of the input came from cache. 0 on the first call of a session.
    cacheHitRatio: totalIn ? +(cacheRead / totalIn).toFixed(3) : 0,
    usd: usd === null ? null : +usd.toFixed(5),
  };
}

/**
 * Single place where we talk to the Anthropic API.
 *
 * `system` may be a plain string or an array of content blocks. Passing an
 * array lets callers place cache_control breakpoints, which is what makes
 * repeat generations cheap: the static rules and the candidate profile are
 * identical between job applications, so only the JD is charged at full rate.
 */
export async function callClaude({
  apiKey, model, system, messages, maxTokens,
  effort = 'medium', thinking = 'adaptive', signal,
}) {
  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages,
    output_config: { effort },
  };

  // Opus 5 thinks by default; Sonnet 5 does too when the field is omitted.
  // For mechanical extraction we turn it off explicitly to save output tokens.
  if (thinking === 'disabled') body.thinking = { type: 'disabled' };
  else                        body.thinking = { type: 'adaptive' };

  const started = Date.now();
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal,
  });

  const data = await upstream.json();
  const ms = Date.now() - started;

  if (!upstream.ok) {
    const err = new Error(data?.error?.message || 'Anthropic API error');
    err.status = upstream.status;
    err.upstream = data?.error;
    throw err;
  }

  // Thinking blocks come back as separate content blocks - take the text ones.
  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();

  return { text, usage: costOf(model, data.usage), raw: data, ms };
}

/**
 * Record what a call cost.
 *
 * Always writes one structured line to the function log (visible in Vercel's
 * log viewer). If USAGE_WEBHOOK_URL is set, it also POSTs the same record
 * somewhere durable — a Railway service, an Upstash endpoint, a Google Sheet
 * webhook, anything that accepts JSON.
 *
 * Awaited rather than fired-and-forgotten, because a serverless function can be
 * frozen the moment it responds and an un-awaited POST would silently vanish.
 * Bounded to 1.5s and never allowed to fail the user's request.
 */
export async function logUsage(route, usage, extra = {}) {
  const record = {
    ts: new Date().toISOString(),
    route,
    ...usage,
    ...extra,
  };

  console.log('USAGE ' + JSON.stringify(record));

  const url = process.env.USAGE_WEBHOOK_URL;
  if (!url) return;

  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.USAGE_WEBHOOK_SECRET
          ? { 'Authorization': 'Bearer ' + process.env.USAGE_WEBHOOK_SECRET }
          : {}),
      },
      body: JSON.stringify(record),
      signal: AbortSignal.timeout(1500),
    });
  } catch (err) {
    // Logging must never break resume generation.
    console.error('Usage webhook failed:', err.message);
  }
}

/** Map an upstream error onto a message that is safe to show a user. */
export function friendlyError(status) {
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status === 401 || status === 403) return 'API key rejected. Contact the site owner.';
  if (status >= 500) return 'The AI service is temporarily unavailable. Please try again shortly.';
  return 'Request failed. Please check your input and try again.';
}

/**
 * Pull a JSON object out of a model response.
 *
 * Plain JSON.parse is brittle: the model may wrap the object in a code fence
 * or add a sentence before it. This strips fences, then walks the string to
 * find the first balanced top-level {...}, ignoring braces inside strings.
 */
export function extractJson(raw) {
  if (!raw) return null;
  let s = raw.replace(/```(?:json)?/gi, '').trim();

  try { return JSON.parse(s); } catch { /* fall through to brace matching */ }

  const start = s.indexOf('{');
  if (start === -1) return null;

  let depth = 0, inStr = false, escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (escaped)        escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"')  inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/** Standard CORS + method guard. Returns true if the request is already handled. */
export function preflight(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return true; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return true; }
  return false;
}
