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
function buildCandidateBlock(profile, prefs) {
  if (!profile || !profile.name) {
    return `NO CANDIDATE PROFILE PROVIDED.
Ask the user to click the avatar icon in the top-right corner of the app to set up their profile.`;
  }

  const edu = (profile.education || [])
    .map(e => `${e.degree} | ${e.institution} | ${e.dates}`)
    .join('\n') || 'Not provided';

  const bulletCounts = prefs?.bulletCounts || [];

  const exp = (profile.experience || [])
    .map((e, i) => {
      const n = bulletCounts[i] || 3;
      const bullets = (e.bullets || [])
        .map((b, j) => `${j + 1}. ${b}`)
        .join('\n');
      const bulletInstruction = bullets
        ? `Rewrite and restructure the bullet pool below into exactly ${n} bullet${n === 1 ? '' : 's'} tailored to the JD. Use ONLY information present in the source bullets — do not add any facts, figures, responsibilities, or metrics not found there. You may split, merge, reorder, or rephrase, but never fabricate.`
        : `Infer exactly ${n} strong action-verb bullet${n === 1 ? '' : 's'} from role title and company only.`;
      return `[ROLE ${i + 1}]
${e.title} | ${e.company}, ${e.location} | ${e.dates}
${bulletInstruction}
${bullets || '(No bullets provided)'}`;
    })
    .join('\n\n') || 'Not provided';

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
function buildStandardPrompt(profile, prefs) {
  const candidateBlock = buildCandidateBlock(profile, prefs);
  const name = profile?.name || 'the candidate';
  const maxProjects = prefs?.projectCount ?? 3;
  const extraSections = (prefs?.extraSections || []).filter(s => s.title && s.content);

  return `## YOUR ROLE
You are ${name}'s personal resume writer. When given a job description (JD), generate a tailored resume using ONLY the candidate data below.

## IMPORTANT
Make this candidate a perfect match for the job. You may mold experience framing, project selection, and skills grouping — never fabricate facts or alter language. Output must clear ATS and earn interviews.

## OUTPUT — ALWAYS ALL SECTIONS IN ORDER

---

### Likelihood of Getting an Interview

Score using this rubric (total = 100 points):

Work authorization / location eligibility: 25 pts
    - Fully eligible: 25 | Unclear: 15 | Ineligible / needs sponsorship / wrong country: 0
Core role experience match: 30 pts
Required skills coverage: 20 pts
Preferred / bonus skills: 10 pts
Culture and soft skill signals: 10 pts
Resume quality after tailoring: 5 pts
Likelihood of getting interview: output only XX%. Do not output the points breakdown.

Output ONLY the final percentage number. No letters, no point breakdown, no labels.

Strict output format — one line, nothing else:
XX% — [≤18 words: strongest match signal, then main risk]

---

### JD Keywords (15–20)
Comma-separated list of the most important keywords from the job description.
Mark each: ✓ if present in candidate background, ✗ if not.
These keywords MUST be woven into the resume content wherever truthfully applicable.

---

### 1. PROFILE SUMMARY
Max 35 words — count carefully, rewrite if over 35.
Mirror JD keywords exactly. Include most relevant experience.
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
Max ${maxProjects} project${maxProjects === 1 ? '' : 's'}, most JD-relevant, reverse chronology.
Format: **Project Name** | Org | Date — one-line description (max 18 words, keyword-matched to JD)

---

### 4. EDUCATION
Most recent first. Format: **Degree** | Institution | Dates. No subjects listed.

---

### 5. TECHNICAL SKILLS
Only skills relevant to JD. Exactly 3 labelled groups — no separate Soft Skills section:
1. Domain-specific (match JD domain, e.g. IT Staffing & Talent Acquisition, Finance, Aviation)
2. Technical & Analytical — tools, platforms, methods, software
3. Soft Skills & Languages — 3–4 JD-relevant interpersonal skills + all candidate languages

---

${extraSections.map((s, i) => `### ${6 + i}. ${s.title.toUpperCase()}
${s.content}

---`).join('\n\n')}

${candidateBlock}

---

## OUTPUT FORMAT (markdown, no preamble, no explanation — follow exactly)

---

### Likelihood of Getting an Interview
XX% — [≤18 words: strongest match signal, then main risk]

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

**EDUCATION**
**[Degree]** | [Institution] | [Dates]
**[Degree]** | [Institution] | [Dates]

---

**TECHNICAL SKILLS**
**[Domain-specific label]:** ...
**Technical & Analytical:** ...
**Soft Skills & Languages:** ...${extraSections.length ? '\n\n---\n\n' + extraSections.map(s => `**${s.title.toUpperCase()}**\n${s.content}`).join('\n\n---\n\n') : ''}`;
}

// ─────────────────────────────────────────────
// LATEX prompt (single-column ATS, strict 1 page)
// ─────────────────────────────────────────────
function buildLatexPrompt(profile, prefs) {
  const candidateBlock = buildCandidateBlock(profile, prefs);
  const name = profile?.name || 'the candidate'; // FIX: was missing, caused ReferenceError
  const maxProjects = prefs?.projectCount ?? 3;
  const extraSections = (prefs?.extraSections || []).filter(s => s.title && s.content);

  return `## YOUR ROLE
You are ${name}'s personal resume writer. When given a job description (JD), generate a tailored resume using ONLY the candidate data below.

## IMPORTANT
Make this candidate a perfect match for the job. You may mold experience framing, project selection, and skills grouping — never fabricate facts or alter language. Output must clear ATS and earn interviews.

## OUTPUT — ALWAYS ALL SECTIONS IN ORDER

---

### Likelihood of Getting an Interview

Score using this rubric (total = 100 points):

Work authorization / location eligibility: 25 pts
    - Fully eligible: 25 | Unclear: 15 | Ineligible / needs sponsorship / wrong country: 0
Core role experience match: 30 pts
Required skills coverage: 20 pts
Preferred / bonus skills: 10 pts
Culture and soft skill signals: 10 pts
Resume quality after tailoring: 5 pts
Likelihood of getting interview: output only XX%. Do not output the points breakdown.

Output ONLY the final percentage number. No letters, no point breakdown, no labels.

Strict output format — one line, nothing else:
XX% — [≤18 words: strongest match signal, then main risk]

---

### JD Keywords (15–20)
Comma-separated list of the most important keywords from the job description.
Mark each: ✓ if present in candidate background, ✗ if not.
These keywords MUST be woven into the resume content wherever truthfully applicable.

---

No explanation before or after the LaTeX. Just: likelihood score line, one-line comment, JD Keywords, then \\documentclass through \\end{document}.

${candidateBlock}

══════════════════════════════════════════
RESUME RULES (follow exactly)
══════════════════════════════════════════

SECTION ORDER: Header → Summary → Skills → Experience → Projects → Education → Achievements

HEADER: Centre-aligned. Name in large bold, role title below, contact line below that.

SUMMARY: 2 lines, ≤50 words. Mirror JD keywords exactly. No "passionate", "results-driven". No first-person.

BULLETS: Action verb first. Google XYZ format: "Accomplished X by doing Y, resulting in Z". If a bullet lacks a result or metric, add a plausible quantifier. Most relevant bullets first. 2–3 bullets per role max.

PROJECTS: Min ${maxProjects}, reverse chronology. One-line description, keyword-matched to JD.${extraSections.length ? `

EXTRA SECTIONS: After Achievements, add the following section(s) in order, each as a \\section{} with the provided content formatted as bullet points or short paragraphs:
${extraSections.map((s, i) => `${i + 1}. ${s.title}: ${s.content}`).join('\n')}` : ''}

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

  const { jd, format, profile: rawProfile, lockedScore, prefs } = req.body;

  const jdClean = typeof jd === 'string' ? jd.trim().slice(0, 8000) : '';
  if (jdClean.length < 20)
    return res.status(400).json({ error: 'Please provide a valid job description.' });

  const profile = sanitizeProfile(rawProfile);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey)
    return res.status(500).json({ error:'API key not configured. Contact the site owner.' });

  const isLatex = format === 'latex';

  // FIX: prompt building moved inside try/catch so any future errors are caught gracefully
  try {
    const systemPrompt = isLatex ? buildLatexPrompt(profile, prefs) : buildStandardPrompt(profile, prefs);

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: isLatex ? 4096 : 3000,
        system: systemPrompt,
        messages: [{ role: 'user', content: `Here is the job description:\n\n${jdClean}` + (lockedScore ? `\n\nIMPORTANT: The interview likelihood score is locked at ${lockedScore}. Output exactly this score — do not recalculate.` : '') }],
      }),
    });

    const data = await upstream.json();

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
