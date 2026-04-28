export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text } = req.body;
  if (!text || text.trim().length < 50)
    return res.status(400).json({ error: 'Resume text too short or empty.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey)
    return res.status(500).json({ error: 'API key not configured.' });

  const SYSTEM = `Extract resume information and return ONLY valid JSON. No markdown, no backticks, no explanation. Exactly this structure:
{
  "name": "",
  "email": "",
  "phone": "",
  "location": "",
  "education": [
    { "degree": "", "institution": "", "dates": "" }
  ],
  "experience": [
    { "title": "", "company": "", "location": "", "dates": "", "bullets": [""] }
  ],
  "projects": [
    { "name": "", "org": "", "dates": "", "keywords": "" }
  ],
  "skills": "",
  "achievements": [""],
  "languages": ""
}

Rules:
- bullets: extract all bullet points / responsibilities from each role as an array of strings
- skills: combine all skills into a single comma-separated string grouped by category if possible
- achievements: array of plain strings (awards, competitions, scholarships)
- languages: single string listing all languages with levels if present
- If a field is not found, use empty string or empty array
- Return raw JSON only, nothing else`;

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2500,
        system: SYSTEM,
        messages: [{ role: 'user', content: `Parse this resume:\n\n${text}` }],
      }),
    });

    const data = await upstream.json();
    if (!upstream.ok)
      return res.status(upstream.status).json({ error: data?.error?.message || 'Parse API error' });

    const raw = data.content?.[0]?.text || '{}';

    // Strip any accidental markdown fences
    const clean = raw.replace(/```json|```/g, '').trim();

    let profile;
    try {
      profile = JSON.parse(clean);
    } catch {
      return res.status(500).json({ error: 'Could not parse AI response as JSON. Try again.' });
    }

    return res.status(200).json({ profile });

  } catch (err) {
    console.error('Parse-resume error:', err);
    return res.status(500).json({ error: 'Server error during parsing.' });
  }
}
