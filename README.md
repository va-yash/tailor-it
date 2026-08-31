# Tailor It — v3

Paste a job description, get either a tailored CV (Markdown, one-column LaTeX,
or two-column LaTeX) or a cover letter of a length you choose.

---

## Directory

```
tailor-it/
├── index.html               ← the whole front end (UI, bulk import, usage panel)
├── package.json             ← "type": "module" + the stress-test script
├── vercel.json              ← raises function timeout to 60s
├── README.md                ← this file
├── api/
│   ├── _lib.js              ← MODELS live here · pricing · usage logging
│   ├── config.js            ← NEW · reports which model is running
│   ├── generate.js          ← CV + cover-letter prompts
│   ├── parse-resume.js      ← reads one resume into fields
│   └── parse-bundle.js      ← optional tidy pass after a bulk import
└── scripts/
    └── stress-test.mjs      ← compares models on quality + cost
```

Files starting with `_` are ignored by Vercel's router, so `_lib.js` is shared
code and not a public endpoint.

---

## 1. Which model is running, and how to change it

**Right now: `claude-opus-5` writes, `claude-sonnet-5` parses.**

You no longer have to take my word for it — the model name is shown in the app
header, next to "Feedback", read live from the deployment. Hover it for the full
detail (both models, effort levels, whether the API key is set).

### Where it is set

[`api/_lib.js`](api/_lib.js), near the top:

```js
export const MODELS = {
  generate: process.env.GENERATE_MODEL || 'claude-opus-5',
  parse:    process.env.PARSE_MODEL    || 'claude-sonnet-5',
  bundle:   process.env.BUNDLE_MODEL   || 'claude-sonnet-5',
};
```

The `process.env.X ||` part means: *use the environment variable if one is set,
otherwise use this default.*

### How to change it — two ways

**Option A — Vercel dashboard (no code change, recommended)**

1. Vercel → your project → **Settings** → **Environment Variables**
2. **Add New**: Key `GENERATE_MODEL`, Value `claude-sonnet-5`, all environments
3. Save, then **Deployments** → latest → **⋯** → **Redeploy**
   (env vars only apply to a new deployment)
4. Reload the app — the header badge shows the new model

**Option B — edit the code**

Change the string after `||` in `api/_lib.js`, commit, push. Vercel redeploys.

### Valid model IDs

| ID | Input / Output per 1M tokens | Notes |
|---|---|---|
| `claude-opus-5` | $5 / $25 | Current default for writing |
| `claude-sonnet-5` | $2 / $10 | Current default for parsing |
| `claude-opus-4-8` | $5 / $25 | Previous Opus |
| `claude-sonnet-4-6` | $3 / $15 | What v1 used |
| `claude-haiku-4-5` | $1 / $5 | Cheapest, weakest writing |

Use the ID exactly as written — never add a date suffix.

Also available: `GENERATE_EFFORT` / `PARSE_EFFORT` / `BUNDLE_EFFORT`
(`low` · `medium` · `high` · `xhigh` · `max`). Higher effort means more
reasoning, better output on hard tasks, more tokens. Writing defaults to
`medium`, parsing to `low`.

---

## 2. Tracking token usage

Four levels. **You almost certainly only need the first two, and neither needs
Railway.**

### Level 1 — in the app (already built, nothing to set up)

The meter under the Generate button shows model, input tokens, cached tokens,
output tokens, cost of that run, and a session total.

Click **"All time ↗"** for the full history: today / 7-day / all-time spend,
a per-day table, a per-model table, the last 15 calls, and **Download CSV**.

This is stored in your browser (`localStorage`), so it survives reloads and
restarts, but it is per-browser and per-device, and clearing site data erases it.

### Level 2 — Anthropic Console (authoritative)

**[console.anthropic.com → Usage](https://console.anthropic.com/settings/usage)**

This is the real billing record — every call on your key, across every device,
broken down by model and day. Level 1 is a convenience; this is the truth.

**Do this now regardless:** Console → **Limits** → set a monthly spend cap.
It is the only thing that actually protects you if the open endpoint (§5) gets
found.

### Level 3 — Vercel function logs (already built)

Every call writes one structured line:

```
USAGE {"ts":"2026-09-01T10:12:04Z","route":"generate","model":"claude-opus-5","inputTokens":812,"cacheReadTokens":2400,"outputTokens":1150,"usd":0.03281,"format":"latex"}
```

Vercel → project → **Logs**. Hobby keeps roughly an hour of logs, so this is for
debugging, not history.

### Level 4 — your own database (this is where Railway fits)

Set one environment variable and every call is POSTed as JSON to a URL you own:

```
USAGE_WEBHOOK_URL=https://your-service.up.railway.app/usage
USAGE_WEBHOOK_SECRET=some-long-random-string     (optional; sent as a Bearer token)
```

The body is the same record shown in Level 3. The POST is capped at 1.5s and can
never fail a resume generation.

A minimal Railway receiver — one file, no dependencies beyond `pg`:

```js
// server.js  ·  Railway: add a Postgres plugin, it sets DATABASE_URL for you
import http from 'node:http';
import pg from 'pg';

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await db.query(`CREATE TABLE IF NOT EXISTS usage (
  id SERIAL PRIMARY KEY, ts TIMESTAMPTZ, route TEXT, model TEXT,
  input_tokens INT, cache_read INT, cache_write INT, output_tokens INT, usd NUMERIC)`);

http.createServer(async (req, res) => {
  if (req.method !== 'POST') { res.writeHead(405).end(); return; }
  if (process.env.SECRET && req.headers.authorization !== 'Bearer ' + process.env.SECRET) {
    res.writeHead(401).end(); return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  const r = JSON.parse(body);
  await db.query(
    `INSERT INTO usage (ts,route,model,input_tokens,cache_read,cache_write,output_tokens,usd)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [r.ts, r.route, r.model, r.inputTokens, r.cacheReadTokens, r.cacheWriteTokens, r.outputTokens, r.usd]
  );
  res.writeHead(204).end();
}).listen(process.env.PORT || 3000);
```

**My honest recommendation:** skip this. The Console already gives you
authoritative per-day, per-model cost with zero code, and the in-app panel
covers day-to-day curiosity with a CSV export. Level 4 earns its keep only if
you want one permanent record across several devices, or you later add other
users and need per-user attribution. Your Railway Hobby plan can host it fine —
it is just not solving a problem you currently have.

---

## 3. Cover letters

Fourth button in the format row: **✉ Cover Letter** (orange, so it is obvious
it produces something different).

- **You pick the length.** Type a number, or use Short (180) / Standard (250) /
  Detailed (350). Range 120–500 words, remembered with your profile.
- The word count is checked after generation and shown under the letter —
  **green** if it hit the target, **red** if it drifted.
- Rendered as a letter on paper, not as resume sections, so you can see at a
  glance it is a different document.
- **Copy** copies the letter only — never the score line above it.

### How it is written

Same plain-English rules as the CV, expanded banned list — *comprehend,
comprehensive, spearheaded, leverage, robust, dynamic, passionate, streamline,
seamless, delve, pivotal, adept…* — and the same facts-vs-figures rule.

Fixed structure, all prose, no bullet points:

| Part | Job |
|---|---|
| Subject | "Application for \<exact JD title\>" + reference number |
| Greeting | Named person if the JD gives one, never "To Whom It May Concern" |
| Para 1 | Who you are and why this role — something showing the JD was read |
| Para 2 | Strongest evidence: what you did → what it contributed → which skill |
| Para 3 | Skills matched to the JD; names any gap once, without apologising |
| Para 4 | Availability, then one plain sentence offering to talk |
| Sign-off | "Yours sincerely," + your name |

It is told not to restate the CV line by line, and to delete any sentence that
could appear in an application for any other job.

The length target travels in the user message rather than the system prompt, so
changing it does **not** throw away your cached prompt.

---

## 4. Bulk import — a stack of old resumes into one profile

**My Profile → Bulk import.** Drop a ZIP, or select many files at once.
PDF, Word and TXT are read; images inside a ZIP are skipped (add those singly in
Single mode, where the vision model can read them).

1. **Text extraction** — in your browser. Free, no API calls.
2. **Parsing** — one small request per resume, three at a time. A file that
   fails is reported and skipped; it cannot sink the batch.
3. **Merging** — in your browser, no API call. Roles group by employer and title
   similarity, and **every distinct bullet is kept**.

Conflicting information is expected: the fullest wording wins, and a role is
never dropped because two CVs disagree. Afterwards you are offered one optional
AI pass to remove paraphrased duplicates.

Limits: 40 files, 12 bullets per role, 10 roles.

---

## 5. Known risk: the API is open

`/api/*` accepts requests from anywhere and has no rate limit. Anyone with your
deployment URL can spend your API credit. Mitigations:

- `ALLOWED_ORIGIN=https://your-domain.vercel.app` — stops other websites, not `curl`
- **A monthly spend cap in the Anthropic Console** — do this today
- Proper fix: an IP rate limiter backed by Vercel KV or Upstash

---

## 6. Stress test — which model actually wins

```bash
node scripts/stress-test.mjs --selftest
```

Free. Checks the grader can tell good output from bad before you spend anything.

```bash
node scripts/stress-test.mjs --profile me.json --jd airbus.txt --runs 2
```

Runs the **real production prompt** through several models, scores each output
(summary length, availability placement, interpersonal-before-technical, bullets
over 26 words, banned words, LaTeX brace balance), and prints quality, cost and
latency side by side. Full outputs land in `./stress-out/`.

Cover letters too:

```bash
node scripts/stress-test.mjs --format coverletter --words 250
```

Export your profile from the browser console: `copy(localStorage.tailorit_profile)`

Roughly $0.10–0.20 per full comparison. The script prints the winning env vars
at the end. **Read the actual output before trusting the score** — the grader
checks rule compliance, not whether the writing is any good.

---

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | *(required)* | Your API key |
| `GENERATE_MODEL` | `claude-opus-5` | Writes CVs and cover letters |
| `PARSE_MODEL` | `claude-sonnet-5` | Reads uploaded resumes |
| `BUNDLE_MODEL` | `claude-sonnet-5` | Optional tidy pass |
| `GENERATE_EFFORT` | `medium` | Reasoning depth when writing |
| `PARSE_EFFORT` | `low` | Reasoning depth when parsing |
| `BUNDLE_EFFORT` | `low` | Reasoning depth when tidying |
| `ALLOWED_ORIGIN` | `*` | Restrict the API to your domain |
| `USAGE_WEBHOOK_URL` | *(unset)* | POST every usage record here |
| `USAGE_WEBHOOK_SECRET` | *(unset)* | Bearer token for that webhook |
