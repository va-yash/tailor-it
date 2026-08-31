import { MODELS, EFFORT, callClaude, friendlyError, preflight, extractJson, logUsage } from './_lib.js';
import { PROFILE_SHAPE } from './parse-resume.js';

// Optional consolidation pass for a profile merged from a stack of old resumes.
//
// The browser has already parsed each resume separately and merged the results
// locally, which handles everything mechanical (unions, exact duplicates,
// grouping roles by employer) for free. What it cannot do is spot that two
// bullets are the same achievement written two different ways, or reconcile a
// job title that three CVs word three ways. That judgement is what this asks
// the model for — on the compact merged JSON, not on the raw resume text, so
// it stays one small fast call instead of a 25-document mega-request.

const SYSTEM = `You are given ONE person's master resume profile, built by merging
several of their old resumes. Clean it up and return ONLY valid JSON in exactly
this structure:

${PROFILE_SHAPE}

## What to fix

DUPLICATE BULLETS — the merge only removed bullets that were textually almost
identical. Find the ones that describe the same achievement in different words
and keep only the best version: the one with the most specific detail (a number,
a tool name, a named system). If two bullets differ in any real detail, KEEP
BOTH — they give the later tailoring step more to choose from.

JOB TITLES — where one role carries a title stitched together from several
resumes, settle on the clearest single title the sources support. Never invent
a title more senior than the sources show.

DATES — keep the widest range the sources support. Normalise the format to
"Mon YYYY – Mon YYYY" (or "Mon YYYY – Present").

ROLES — if two entries are obviously the same job at the same employer, merge
them and pool their bullets. If they are genuinely different jobs at the same
employer, leave them separate.

SKILLS / SOFTSKILLS / LANGUAGES — remove repeats and near-repeats, keep the
clearest wording of each, keep them comma-separated.

## Hard limits
- Never invent anything. Every claim must already exist in the input.
- Never drop a role, a qualification or an employer.
- Keep at most 12 bullets per role. Over that, drop the vaguest ones.
- Preserve the candidate's own wording where you can; this is a cleanup pass,
  not a rewrite. The tailoring step does the rewriting later.

Return raw JSON only. No markdown, no backticks, no commentary.`;

export default async function handler(req, res) {
  if (preflight(req, res)) return;

  const { profile } = req.body || {};

  if (!profile || typeof profile !== 'object')
    return res.status(400).json({ error: 'No profile provided.' });

  const asText = JSON.stringify(profile);
  if (asText.length < 40)
    return res.status(400).json({ error: 'Profile is empty — nothing to tidy.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey)
    return res.status(500).json({ error: 'API key not configured.' });

  try {
    const { text: raw, usage } = await callClaude({
      apiKey,
      model: MODELS.bundle,
      effort: EFFORT.bundle,
      // Spotting paraphrased duplicates is a judgement call, so this one keeps
      // thinking on — at low effort, since the task is still narrow.
      thinking: 'adaptive',
      maxTokens: 8000,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `MERGED PROFILE:\n${asText.slice(0, 60000)}\n\nReturn the cleaned profile as raw JSON.`,
      }],
    });

    const cleaned = extractJson(raw);
    if (!cleaned)
      return res.status(502).json({ error: 'Could not read the AI response. Your merged profile is unchanged.' });

    await logUsage("parse-bundle", usage);

    return res.status(200).json({ profile: cleaned, usage });

  } catch (err) {
    console.error('Parse-bundle error:', err.status || '', err.message);
    const status = err.status && err.status >= 400 ? err.status : 500;
    return res.status(status).json({ error: friendlyError(status) });
  }
}
