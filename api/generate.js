// ─────────────────────────────────────────────
// Input sanitization helpers
// ─────────────────────────────────────────────

function sanitizeString(val, maxLen = 500) {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function sanitizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const sanitizeArr = (arr, maxItems, itemFn) =>
    Array.isArray(arr) ? arr.slice(0, maxItems).map(itemFn) : [];

  return {
    name:      sanitizeString(raw.name, 100),
    email:     sanitizeString(raw.email, 100),
    phone:     sanitizeString(raw.phone, 30),
    location:  sanitizeString(raw.location, 100),
    skills:    sanitizeString(raw.skills, 600),
    languages: sanitizeString(raw.languages, 200),

    education: sanitizeArr(raw.education, 5, e => ({
      degree:      sanitizeString(e.degree, 150),
      institution: sanitizeString(e.institution, 150),
      dates:       sanitizeString(e.dates, 50),
    })),

    experience: sanitizeArr(raw.experience, 8, e => ({
      title:    sanitizeString(e.title, 150),
      company:  sanitizeString(e.company, 150),
      location: sanitizeString(e.location, 100),
      dates:    sanitizeString(e.dates, 50),
      bullets:  Array.isArray(e.bullets)
        ? e.bullets.slice(0, 8).map(b => sanitizeString(b, 300))
        : [],
    })),

    projects: sanitizeArr(raw.projects, 6, p => ({
      name:     sanitizeString(p.name, 150),
      org:      sanitizeString(p.org, 150),
      dates:    sanitizeString(p.dates, 50),
      keywords: sanitizeString(p.keywords, 300),
    })),

    achievements: sanitizeArr(raw.achievements, 8, a => ({
      text: sanitizeString(a.text || a, 300),
    })),
  };
}

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
Pick 2–3 most JD-relevant bullets. If a bullet lacks a metric or result, add a plausible quantifier based on role context:
${bullets || '(No bullets provided — infer strong action-verb bullets from role title and company)'}`;
    })
    .join('\n\n') || 'Not provided';

  // FIX #10 — label project keywords so Claude knows they are technologies/tools
  const projects = (profile.projects || [])
    .map((p, i) => `P${i + 1}. **${p.name}** | ${p.org} | ${p.dates} | Tech: ${p.keywords}`)
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

## OUTPUT — ALWAYS ALL SECTIONS IN ORDER

---

### Likelihood of Getting an Interview

Score using this rubric (total = 100 points):

[A] Work authorization / location eligibility: 25 pts
    - Candidate location and visa status fully matches JD requirement: 25
    - JD requirement unclear or not stated: 15
    - Candidate likely ineligible (wrong country, needs sponsorship, JD says no sponsorship): 0

[B] Core role experience match: 30 pts
    - Direct, titled experience in this role: 25–30
    - Transferable experience, adjacent role: 10–20
    - Weak or unrelated background: 0–10

[C] Required skills coverage: 20 pts
    - Covers all explicitly required skills: 20
    - Covers most: 10–15
    - Misses key required skills: 0–10

[D] Preferred / bonus skills: 10 pts

[E] Culture and soft skill signals in profile: 10 pts

[F] Resume quality after your tailoring: 5 pts
Likelihood of getting interview XX% = A:[pts] B:[pts] C:[pts] D:[pts] E:[pts] F:[pts] (Output only the percentage (XX%), not the following equation

Output format:
XX%: [2-line comment — lead with the aligning positive comment and follow it with single biggest risk factor and others if required]

---

### JD Keywords (15–20)
Comma-separated list of the most important keywords from the job description.
Mark each: ✓ if present in candidate background, ✗ if not.
These keywords MUST be woven into the resume content wherever truthfully applicable.

---

### 1. PROFILE SUMMARY
Max 35 words — count carefully, rewrite if over 35.
Mirror JD keywords exactly. Include most relevant experience + availability.
No "dynamic", "passionate", "results-driven", or first-person pronouns.

---

### 2. EXPERIENCE
For each role in the candidate data:
- Tailor the role title to match the JD
- Pick 2–3 most JD-relevant bullets from the bullet pool
- If a bullet lacks a result or metric, add a plausible quantifier
- Each bullet max 25 words, strong action verb first

---

### 3. RELEVANT PROJECTS
Max 3 projects, most JD-relevant, reverse chronology.
Format: **Project Name** | Org | Date — one-line description (max 18 words, keyword-matched to JD)

---

### 4. TECHNICAL SKILLS
Only skills relevant to JD. Exactly 3 labelled groups — no separate Soft Skills section:
1. Domain-specific (match JD domain, e.g. IT Staffing & Talent Acquisition, Finance, Aviation)
2. Technical & Analytical — tools, platforms, methods, software
3. Soft Skills & Languages — 3–4 JD-relevant interpersonal skills + all candidate languages

---

${candidateBlock}

---

## OUTPUT FORMAT (markdown, no preamble, no explanation — follow exactly)

---

### Likelihood of Getting an Interview
XX% = A:[pts] B:[pts] C:[pts] D:[pts] E:[pts] F:[pts]
[2-line comment]

---

### JD Keywords
[keyword ✓, keyword ✗, keyword ✓, ...]

---

**PROFILE SUMMARY**
[max 35 words — recount and rewrite if over]

---

**EXPERIENCE**

[Tailored title | Company, Location | Dates]
- [bullet ≤25 words]
- [bullet ≤25 words]

[Tailored title | Company, Location | Dates]
- [bullet ≤25 words]
- [bullet ≤25 words]

---

**RELEVANT PROJECTS**
- **[Name]** | [Org] | [Date] — [description ≤18 words]
- **[Name]** | [Org] | [Date] — [description ≤18 words]
- **[Name]** | [Org] | [Date] — [description ≤18 words]

---

**TECHNICAL SKILLS**
**[Domain-specific label]:** ...
**Technical & Analytical:** ...
**Soft Skills & Languages:** ...`;
}

// ─────────────────────────────────────────────
// LATEX prompt (single-column ATS, strict 1 page)
// ─────────────────────────────────────────────
function buildLatexPrompt(profile) {
  const candidateBlock = buildCandidateBlock(profile);

  return `You are a personal resume writer. When given a job description, output a complete, compile-ready LaTeX resume — nothing else.

### First output (not on resume) — Likelihood of getting an interview
Score using this rubric (total = 100 points):

[A] Work authorization / location eligibility: 25 pts
    - Fully eligible: 25 | Unclear: 15 | Ineligible / needs sponsorship / wrong country: 0
[B] Core role experience match: 30 pts
[C] Required skills coverage: 20 pts
[D] Preferred / bonus skills: 10 pts
[E] Culture and soft skill signals: 10 pts
[F] Resume quality after tailoring: 5 pts

Output: XX% = A:[pts] B:[pts] C:[pts] D:[pts] E:[pts] F:[pts]
Then: 2-line comment — lead with the single biggest risk factor.

## IMPORTANT
Make this candidate a perfect match for the job. Mold experience framing, project selection, and skills grouping — never fabricate facts or alter language. Output must clear ATS and earn interviews.

No explanation before or after the LaTeX. Just: likelihood score line, 2-line comment, then \\documentclass through \\end{document}.

${candidateBlock}

══════════════════════════════════════════
RESUME RULES (follow exactly)
══════════════════════════════════════════

SECTION ORDER: Header → Summary → Skills → Experience → Projects → Education → Achievements

HEADER: Centre-aligned. Name in large bold, role title below, contact line below that.

SUMMARY: 2 lines, ≤50 words. Mirror JD keywords exactly. No "passionate", "results-driven". No first-person.

BULLETS: Action verb first. Google XYZ format: "Accomplished X by doing Y, resulting in Z". If a bullet lacks a result or metric, add a plausible quantifier. Most relevant bullets first. 2–3 bullets per role max.

PROJECTS: Min 3, reverse chronology. One-line description, keyword-matched to JD.

ACHIEVEMENTS: Always include top 2 most JD-relevant.

SKILLS: Exactly 3 labelled rows:
  1. Domain-specific to JD
  2. Technical & Analytical — tools, methods, software
  3. Soft Skills & Languages — 3–4 JD-relevant interpersonal skills + all languages

EDUCATION: Degree title (bold) + institution on same line. Dates on same line. No subjects listed.

══════════════════════════════════════════
ONE-PAGE STRICT ENFORCEMENT
══════════════════════════════════════════

The resume MUST fit on exactly one A4 page. This is non-negotiable.

Margins: top=0.45in, bottom=0.45in, left=0.55in, right=0.55in.
Font: 10pt base. Never increase font size.
Bullet itemsep=0pt, parsep=0pt, topsep=0pt.
\\vspace between roles/projects: 1pt max.
Parskip: 0pt throughout.

If content is still too long, apply cuts in this strict priority order:
  1. Trim project descriptions to one short clause (≤10 words)
  2. Remove the least JD-relevant project entirely
  3. Trim achievement text to ≤8 words each
  4. Reduce each bullet to ≤18 words
  5. Drop the least relevant bullet from the least relevant role
  NEVER cut: all experience roles, all education entries, skills section, summary.
  NEVER go to page 2 under any circumstances.

══════════════════════════════════════════
LATEX OUTPUT RULES
══════════════════════════════════════════

Packages only: geometry, fontenc (T1), inputenc (utf8), microtype, enumitem, titlesec, hyperref, xcolor, parskip

Style: Jake Ryan / Harvard OCS — clean single-column, small-caps ruled section headers.

ATS: Single column only. No tables, no multi-column, no icons, no photos, no \\includegraphics. Standard section headings only.

No text before \\documentclass. No text after \\end{document}.

\\documentclass[10pt,a4paper]{article}
\\usepackage[top=0.45in,bottom=0.45in,left=0.55in,right=0.55in]{geometry}
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
\\titleformat{\\section}{\\vspace{-10pt}\\scshape\\raggedright\\large}{}{0em}{}[\\color{black}\\titlerule\\vspace{-10pt}]
\\setlist[itemize]{leftmargin=*,topsep=0pt,itemsep=0pt,parsep=0pt,label=\\textbullet}

\\begin{document}
\\pagestyle{empty}

% ── HEADER ──
% \\begin{center}
%   {\\Large \\textbf{Full Name}} \\\\[2pt]
%   Role Title \\\\[2pt]
%   email | phone | location | linkedin
% \\end{center}

% ── SUMMARY ──
% \\section{Summary}
% 2-line summary here.

% ── SKILLS ──
% \\section{Skills}
% \\textbf{Domain:} ... \\\\
% \\textbf{Technical \\& Analytical:} ... \\\\
% \\textbf{Soft Skills \\& Languages:} ...

% ── EXPERIENCE ──
% \\section{Experience}
% \\textbf{Role Title} | Company, Location \\hfill Dates \\\\
% \\vspace{1pt}
% \\begin{itemize}
%   \\item Bullet one
%   \\item Bullet two
% \\end{itemize}

% ── PROJECTS ──
% \\section{Projects}
% \\textbf{Project Name} | Org \\hfill Date \\\\
% One-line description.

% ── EDUCATION ──
% \\section{Education}
% \\textbf{Degree Title} | Institution \\hfill Dates

% ── ACHIEVEMENTS ──
% \\section{Achievements}
% \\begin{itemize}
%   \\item Achievement one
%   \\item Achievement two
% \\end{itemize}

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

  const { jd, format, profile: rawProfile } = req.body;

  // FIX #13 — cap JD length
  const jdClean = typeof jd === 'string' ? jd.trim().slice(0, 8000) : '';
  if (jdClean.length < 20)
    return res.status(400).json({ error: 'Please provide a valid job description.' });

  // FIX #14 — sanitize profile
  const profile = sanitizeProfile(rawProfile);

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
        model: 'claude-sonnet-4-6',
        max_tokens: isLatex ? 4096 : 3000, // FIX #3 — raised from 2000
        system: systemPrompt,
        messages: [{ role: 'user', content: `Here is the job description:\n\n${jdClean}` }],
      }),
    });

    const data = await upstream.json();

    // FIX #15 — don't leak upstream API error details
    if (!upstream.ok) {
      console.error('Anthropic API error:', data?.error);
      return res.status(upstream.status).json({
        error: upstream.status === 429
          ? 'Too many requests. Please wait a moment and try again.'
          : upstream.status >= 500
          ? 'The AI service is temporarily unavailable. Please try again shortly.'
          : 'Failed to generate resume. Please check your input and try again.',
      });
    }

    return res.status(200).json({ content: data.content?.[0]?.text ?? '' });

  } catch (err) {
    console.error('Generate error:', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
