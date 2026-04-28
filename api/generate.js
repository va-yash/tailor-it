// ─────────────────────────────────────────────
// Build the candidate data block from profile
// ─────────────────────────────────────────────
function buildCandidateBlock(profile) {
  if (!profile || !profile.name) {
    return `NO CANDIDATE PROFILE PROVIDED.
Ask the user to click the avatar icon in the top-right corner of the app to set up their profile.`;
  }

  const edu = (profile.education || [])
    .map(e => `${e.degree} | ${e.institution} | ${e.dates}`)
    .join('\n') || 'Not provided';

  const exp = (profile.experience || [])
    .map((e, i) => {
      const bullets = (e.bullets || [])
        .map((b, j) => `${j + 1}. ${b}`)
        .join('\n');
      return `[ROLE ${i + 1}]
${e.title} | ${e.company}, ${e.location} | ${e.dates}
Pick 2–3 most JD-relevant bullets:
${bullets || '(No bullets provided — infer from role title and company)'}`;
    })
    .join('\n\n') || 'Not provided';

  const projects = (profile.projects || [])
    .map((p, i) => `P${i + 1}. **${p.name}** | ${p.org} | ${p.dates} | ${p.keywords}`)
    .join('\n') || 'Not provided';

  const achievements = (profile.achievements || [])
    .map(a => `- ${a.text || a}`)
    .join('\n') || 'Not provided';

  return `══════════════════════════════════════════
CANDIDATE DATA (never alter these facts)
══════════════════════════════════════════

Name: ${profile.name}
${profile.email ? `Email: ${profile.email}` : ''}
${profile.phone ? `Phone: ${profile.phone}` : ''}
${profile.location ? `Location: ${profile.location}` : ''}

── EDUCATION ──
${edu}

── EXPERIENCE ──
${exp}

── PROJECTS ──
Pick 2–3 most JD-relevant from:
${projects}

── SKILLS ──
${profile.skills || 'Not provided'}

── ACHIEVEMENTS ──
${achievements}
${profile.languages ? `\n── LANGUAGES ──\n${profile.languages}` : ''}`;
}

// ─────────────────────────────────────────────
// STANDARD prompt (markdown rendered output)
// ─────────────────────────────────────────────
function buildStandardPrompt(profile) {
  const candidateBlock = buildCandidateBlock(profile);
  const name = profile?.name || 'the candidate';

  return `## YOUR ROLE
You are ${name}'s personal resume writer. When given a job description (JD), generate a tailored resume using ONLY the candidate data below.

## IMPORTANT
Make this candidate a perfect match for the job. You may mold experience framing, project selection, and skills grouping — never fabricate facts or alter language. Output must clear ATS and earn interviews.

## OUTPUT — ALWAYS ALL 5 SECTIONS

### Likelihood of Getting an Interview
Strictly two-digit percentage followed by a 2-line comment. Calculate after applying all your tailoring.

### 1. PROFILE SUMMARY
Max 35 words. Mirror JD keywords exactly. Include most relevant experience + availability. No "dynamic", "passionate", or first-person pronouns.

### 2. EXPERIENCE
For each role in the candidate data:
- Tailor the role title to match the JD
- Pick 2–3 most JD-relevant bullets from the bullet pool
- Each bullet max 25 words, action verb first

### 3. RELEVANT PROJECTS
Max 3 projects, most JD-relevant, reverse chronology.
Format: **Project Name** | Org | Date — one-line description (max 18 words, keyword-matched to JD)

### 4. TECHNICAL SKILLS
Only skills relevant to JD. Exactly 3 labelled groups:
1. Domain-specific (e.g. Aviation & Ops, Hydrogen & Energy, Finance)
2. Technical & Analytical — tools, methods, software
3. Soft Skills & Languages — 3–4 interpersonal skills + all languages

### 5. SOFT SKILLS
Already covered in group 3 above — skip as a separate section.

---

${candidateBlock}

---

## OUTPUT FORMAT (markdown, no preamble, no explanation)

---

### Likelihood of Getting an Interview
[XX%] — [2-line comment]

---

**PROFILE SUMMARY**
[max 35 words]

---

**EXPERIENCE**

[For each role: tailored title | Company, Location | Dates]
- [bullet]
- [bullet]

---

**RELEVANT PROJECTS**
- **[Name]** | [Org] | [Date] — [description]
- **[Name]** | [Org] | [Date] — [description]
- **[Name]** | [Org] | [Date] — [description]

---

**TECHNICAL SKILLS**
**[Domain]:** ...
**Technical & Analytical:** ...
**Soft Skills & Languages:** ...`;
}

// ─────────────────────────────────────────────
// LATEX prompt (single-column ATS)
// ─────────────────────────────────────────────
function buildLatexPrompt(profile) {
  const candidateBlock = buildCandidateBlock(profile);

  return `You are a personal resume writer. When given a job description, output a complete, compile-ready LaTeX resume — nothing else.

### First output (not on resume) — Likelihood of getting an interview
- Strictly two-digit percentage followed by a 2-liner comment
- To be calculated after considering changes suggested by you

## IMPORTANT
Make this candidate a perfect match for the job. Mold experience framing, project selection, and skills grouping — never fabricate facts or alter language. Output must clear ATS and earn interviews.

No explanation before or after the LaTeX. Just: likelihood comment, then \\documentclass through \\end{document}.

${candidateBlock}

══════════════════════════════════════════
RESUME RULES (follow exactly)
══════════════════════════════════════════

SECTION ORDER: Header → Summary → Skills → Experience → Projects → Education → Achievements

HEADER: Centre-aligned.

SUMMARY: 2 lines, ≤50 words. Mirror JD keywords exactly. No "passionate", "results-driven". No first-person.

BULLETS: Action verb first. Google XYZ: "Accomplished X by doing Y, resulting in Z". Most relevant bullets first.

PROJECTS: Min 3, reverse chronology.

ACHIEVEMENTS: Always include top 2 most JD-relevant.

SKILLS: Exactly 3 labelled rows:
  1. Domain-specific to JD
  2. Technical & Analytical — tools, methods, software
  3. Soft Skills & Languages — 3–4 JD-relevant interpersonal skills + all languages

EDUCATION: Degree title (bold) + institution on same line. Dates on same line. No subjects. Include Ulster only if JD-relevant.

ONE PAGE: Margins top/bottom=0.45in, left/right=0.55in. Font 10pt.
Bullet itemsep=0.5pt. \\vspace{2pt} between roles/projects.
If tight: cut project descriptions to 1 line. Never cut experience bullets. Never go to page 2.

ATS: Single column only. No tables, no multi-column, no icons, no photos. Standard section headings.

══════════════════════════════════════════
LATEX OUTPUT RULES
══════════════════════════════════════════

Packages only: geometry, fontenc (T1), inputenc (utf8), microtype, enumitem, titlesec, hyperref, xcolor, parskip

Style: Jake Ryan / Harvard OCS — clean single-column, small-caps ruled section headers.

No text before \\documentclass, no text after \\end{document}.

\\documentclass[10.5pt,a4paper]{article}
\\usepackage[top=0.5in,bottom=0.5in,left=0.6in,right=0.6in]{geometry}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{microtype}
\\usepackage{enumitem}
\\usepackage{titlesec}
\\usepackage{hyperref}
\\usepackage{xcolor}
\\usepackage{parskip}
\\hypersetup{colorlinks=true,urlcolor=black,linkcolor=black}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0pt}
\\titleformat{\\section}{\\vspace{-6pt}\\scshape\\raggedright\\large}{}{0em}{}[\\titlerule\\vspace{-10pt}]
\\setlist[itemize]{leftmargin=*,topsep=0pt,itemsep=1pt,parsep=0pt,label=\\textbullet}

\\begin{document}
\\pagestyle{empty}
% Header, then sections in order
\\end{document}`;
}

// ─────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { jd, format, profile } = req.body;

  if (!jd || jd.trim().length < 20)
    return res.status(400).json({ error: 'Please provide a valid job description.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey)
    return res.status(500).json({ error: 'API key not configured. Contact the site owner.' });

  const isLatex = format === 'latex';
  const systemPrompt = isLatex ? buildLatexPrompt(profile) : buildStandardPrompt(profile);

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
        max_tokens: isLatex ? 4096 : 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: `Here is the job description:\n\n${jd.trim()}` }],
      }),
    });

    const data = await upstream.json();
    if (!upstream.ok)
      return res.status(upstream.status).json({ error: data?.error?.message || `API error ${upstream.status}` });

    return res.status(200).json({ content: data.content?.[0]?.text ?? '' });

  } catch (err) {
    console.error('Generate error:', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
