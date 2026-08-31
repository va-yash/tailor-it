import { MODELS, EFFORT, callClaude, friendlyError, preflight, extractJson, logUsage } from './_lib.js';

export const PROFILE_SHAPE = `{
  "name": "",
  "email": "",
  "phone": "",
  "location": "",
  "linkedin": "",
  "availability": "",
  "education":  [ { "degree": "", "institution": "", "dates": "" } ],
  "experience": [ { "title": "", "company": "", "location": "", "dates": "", "bullets": [""] } ],
  "projects":   [ { "name": "", "org": "", "dates": "", "keywords": "" } ],
  "skills": "",
  "softSkills": "",
  "achievements": [""],
  "languages": ""
}`;

const SYSTEM = `Extract resume information and return ONLY valid JSON. No markdown,
no backticks, no explanation. Use exactly this structure:

${PROFILE_SHAPE}

Rules:
- bullets: every bullet point / responsibility / achievement under each role,
  as an array of strings. Copy them faithfully — do not summarise, shorten,
  merge or improve them. This is a raw pool that gets tailored later, so more
  detail is better than less.
- skills: hard skills only (tools, software, methods, technical domains) as one
  comma-separated string.
- softSkills: interpersonal skills only (teamwork, communication, leadership,
  problem solving...) as one comma-separated string. Include skills clearly
  demonstrated in the experience text even if there is no "soft skills" heading.
- availability: notice period or start date if stated anywhere ("available from
  March 2026", "3 month notice"). Empty string if absent.
- linkedin: the LinkedIn URL or handle if present.
- achievements: array of plain strings (awards, competitions, scholarships).
- languages: one string listing every language with level if present.
- If a field is not found, use an empty string or an empty array.
- Never invent information that is not in the source text.
- Return raw JSON only, nothing else.`;

export default async function handler(req, res) {
  if (preflight(req, res)) return;

  const { text, imageBase64, imageType } = req.body || {};

  const hasText  = typeof text === 'string' && text.trim().length >= 50;
  const hasImage = typeof imageBase64 === 'string' && imageBase64.length > 0 && imageType;

  if (!hasText && !hasImage)
    return res.status(400).json({ error: 'No resume content provided.' });

  // A base64 image roughly 4/3 the size of the file. Vercel rejects bodies
  // over ~4.5MB, so stop early with a message the user can act on.
  if (hasImage && imageBase64.length > 4_000_000)
    return res.status(413).json({ error: 'Image is too large. Use a file under 3MB, or upload the PDF instead.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey)
    return res.status(500).json({ error: 'API key not configured.' });

  try {
    const userContent = hasImage
      ? [
          { type: 'image', source: { type: 'base64', media_type: imageType, data: imageBase64 } },
          { type: 'text',  text: 'This is a resume image. Extract all information and return ONLY the JSON.' },
        ]
      : `Parse this resume:\n\n${text.slice(0, 24000)}`;

    const { text: raw, usage } = await callClaude({
      apiKey,
      model: MODELS.parse,
      effort: EFFORT.parse,
      // Pure extraction — no reasoning needed, and turning it off removes a
      // meaningful slice of the output-token bill.
      thinking: 'disabled',
      maxTokens: 4000,
      system: SYSTEM,
      messages: [{ role: 'user', content: userContent }],
    });

    const profile = extractJson(raw);
    if (!profile)
      return res.status(502).json({ error: 'Could not read the AI response. Please try again.' });

    await logUsage("parse-resume", usage, { source: hasImage ? "image" : "text" });

    return res.status(200).json({ profile, usage });

  } catch (err) {
    console.error('Parse-resume error:', err.status || '', err.message);
    const status = err.status && err.status >= 400 ? err.status : 500;
    return res.status(status).json({ error: friendlyError(status) });
  }
}
