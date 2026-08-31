import { MODELS, EFFORT, callClaude, friendlyError, preflight, logUsage } from './_lib.js';

// ─────────────────────────────────────────────
// Input sanitization
// ─────────────────────────────────────────────

function sanitizeString(val, maxLen = 500) {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

export function sanitizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const sanitizeArr = (arr, maxItems, itemFn) =>
    Array.isArray(arr) ? arr.slice(0, maxItems).map(itemFn) : [];

  return {
    name:         sanitizeString(raw.name, 100),
    email:        sanitizeString(raw.email, 100),
    phone:        sanitizeString(raw.phone, 30),
    location:     sanitizeString(raw.location, 100),
    linkedin:     sanitizeString(raw.linkedin, 150),
    availability: sanitizeString(raw.availability, 120),
    skills:       sanitizeString(raw.skills, 1200),
    softSkills:   sanitizeString(raw.softSkills, 600),
    languages:    sanitizeString(raw.languages, 200),

    education: sanitizeArr(raw.education, 6, e => ({
      degree:      sanitizeString(e.degree, 150),
      institution: sanitizeString(e.institution, 150),
      dates:       sanitizeString(e.dates, 50),
    })),

    // Raised from 8 to 12 bullets per role: a profile merged from a stack of
    // old CVs carries a much deeper bullet pool, and a deeper pool is the
    // whole point - it gives the tailoring step more real material to pick from.
    experience: sanitizeArr(raw.experience, 10, e => ({
      title:    sanitizeString(e.title, 150),
      company:  sanitizeString(e.company, 150),
      location: sanitizeString(e.location, 100),
      dates:    sanitizeString(e.dates, 50),
      bullets:  Array.isArray(e.bullets)
        ? e.bullets.slice(0, 12).map(b => sanitizeString(b, 300)).filter(Boolean)
        : [],
    })),

    projects: sanitizeArr(raw.projects, 8, p => ({
      name:     sanitizeString(p.name, 150),
      org:      sanitizeString(p.org, 150),
      dates:    sanitizeString(p.dates, 50),
      keywords: sanitizeString(p.keywords, 300),
    })),

    achievements: sanitizeArr(raw.achievements, 10, a => ({
      text: sanitizeString(typeof a === 'string' ? a : a?.text, 300),
    })),
  };
}

// Preferences arrive from the browser and land directly in the prompt, so they
// are bounded here just like the profile is.
export function sanitizePrefs(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  return {
    bulletCounts: Array.isArray(p.bulletCounts)
      ? p.bulletCounts.slice(0, 10).map(n => {
          const v = parseInt(n, 10);
          return Number.isFinite(v) ? Math.min(6, Math.max(1, v)) : 3;
        })
      : [],
    projectCount: (() => {
      const v = parseInt(p.projectCount, 10);
      return Number.isFinite(v) ? Math.min(8, Math.max(0, v)) : 3;
    })(),
    coverWords: (() => {
      const v = parseInt(p.coverWords, 10);
      return Number.isFinite(v) ? Math.min(500, Math.max(120, v)) : 250;
    })(),
    extraSections: Array.isArray(p.extraSections)
      ? p.extraSections
          .slice(0, 4)
          .map(s => ({
            title:   sanitizeString(s?.title, 60),
            content: sanitizeString(s?.content, 800),
          }))
          .filter(s => s.title && s.content)
      : [],
  };
}

// ─────────────────────────────────────────────
// BLOCK 1 — static rules. Identical for every user and every JD at a given
// format, so it sits first in the system array behind a cache breakpoint.
// ─────────────────────────────────────────────

const SCORING = `### Likelihood of Getting an Interview

Score internally using this rubric (total = 100 points):
  Work authorisation / location eligibility: 25 pts
      Fully eligible: 25 | Unclear: 15 | Needs sponsorship or wrong country: 0
  Core role experience match: 30 pts
  Required skills coverage: 20 pts
  Preferred / bonus skills: 10 pts
  Culture and interpersonal signals: 10 pts
  Resume quality after tailoring: 5 pts

Do NOT print the breakdown. Output one line only:
XX% — [<=18 words: strongest match signal, then the main risk]`;

// Shared by the resume and the cover letter so the two can never drift apart.
const PLAIN_ENGLISH = `## HOW TO WRITE — this matters more than any other rule below

The reader may not be a native English speaker. Airbus hiring managers and
recruiters across France, Germany, Spain and the UK will read this document.
Write so that all of them understand every line on the first read.

Plain English:
- Use short, common words. "used" not "utilised". "helped" not "facilitated".
- "set up" not "spearheaded the implementation of". "cut" not "drove a reduction in".
- One idea per sentence. If a sentence needs two commas to survive, split it or cut it.
- Prefer concrete nouns over abstract ones. "the wing test rig", not "the asset".
- Write like a competent person talking, not like a brochure.
- Banned words — never use any of these, in any form:
  leverage, synergy, spearhead, orchestrate, robust, dynamic, passionate,
  results-driven, seasoned, holistic, cutting-edge, best-in-class, utilise,
  facilitate, myriad, plethora, stakeholder-centric, comprehensive, comprehend,
  demonstrable, proven track record, deep dive, moving forward, thought leader,
  game-changer, world-class, value-add, mission-critical, streamline, empower,
  endeavour, pivotal, seamless, cultivate, spearheading, adept, delve.
- Never open with "Responsible for" or any other noun phrase.`;

const WRITING_RULES = `${PLAIN_ENGLISH}

Every EXPERIENCE bullet must carry three things, in this order:
  1. WHAT I DID       — the concrete action, in a plain past-tense verb
  2. WHY IT MATTERED  — what it contributed to: the team's goal, the project,
                        the customer, or safety / cost / schedule / quality
  3. WHICH SKILL      — the named tool, method or skill used or learned

Write it as one flowing sentence, not three labelled parts. Example shape:
  "Rebuilt the weekly parts-tracking sheet in Power BI so the line team could
   see delays a day earlier, which taught me to design reports around the
   decision the user actually makes."
Keep each bullet under 26 words.`;

const FACTS_FIGURES = `## FACTS vs FIGURES — these two rules are deliberately different

FACTS are fixed. Never invent or change an employer, job title, date,
qualification, technology, tool, or responsibility. Never describe work that
does not appear in the candidate data. You may reword, merge, split and
reorder what is there — that is the job — but the underlying claim must stay true.

FIGURES may be estimated. Where a real achievement in the source data carries
no number, you may add ONE conservative, plausible quantifier consistent with
the role's seniority and duration. Keep estimates modest and round — "around
15%", not "17.3%". Never estimate a figure the employer could independently
check: salary, total company headcount, official test scores, certification
numbers, or published financials. At most half the bullets in any one role may
carry an estimated figure; a clear plain sentence beats a padded one.`;

// ── COVER LETTER ──────────────────────────────────────────────────────────
// Length is not baked in here: it arrives with the job description in the user
// message, so changing the word count never invalidates the cached prompt.
const COVER_RULES = `## YOUR ROLE
You are writing a cover letter for the candidate below, aimed at one specific
job description.

${PLAIN_ENGLISH}

${FACTS_FIGURES}

## LENGTH — obey the target given in the user message
The user message states a target word count for the letter body. Land within
5% of it. Count the words of the letter body only: not the greeting, not the
sign-off, not the subject line. Write the letter, count, then rewrite to fit.
Longer is not better — if the target is small, cut the weakest paragraph
rather than squeezing every paragraph into something thin.

## STRUCTURE
Write flowing prose. No bullet points anywhere. No headings inside the letter.

  SUBJECT   One line: "Application for <exact job title from the JD>"
            plus the reference number if the JD gives one.

  GREETING  "Dear Hiring Manager," unless the JD names a person, in which case
            use their name. Never "To Whom It May Concern".

  PARA 1 — why this job, and who you are (2-3 sentences)
            Name the role and the company. Say in one plain sentence what you
            do now and what connects it to this job. Say something specific
            about the role or the team that shows the JD was actually read.
            No "I am writing to apply for" as the opening clause — start with
            something the reader has a reason to keep reading.

  PARA 2 — the strongest evidence (3-4 sentences)
            Take the one or two most JD-relevant things from the candidate's
            real experience. For each: what was done, what it contributed to,
            and which skill it used or built. Same rule as the resume bullets,
            but written as prose in the first person.

  PARA 3 — the match, and the gap (2-3 sentences)
            Connect the candidate's hard skills to what the JD asks for, in
            the JD's own words where they are truthful. If the JD asks for
            something the candidate lacks, do not hide it and do not apologise
            for it — name the nearest real thing they do have and move on. One
            clause at most; never dwell on it.

  PARA 4 — close (1-2 sentences)
            State availability using the candidate's availability line. One
            plain sentence offering to talk further. No pleading, no
            "I would be thrilled", no "thank you for your consideration and
            time in reviewing my application".

  SIGN-OFF  "Yours sincerely," then the candidate's name on the next line.

## VOICE
First person, past tense for what was done. Confident and matter-of-fact.
Never restate the resume line by line — the letter explains the fit that the
resume can only list. If a sentence could appear in any application for any
job, delete it and write something only this candidate could write about only
this job.`;

const SECTION_RULES = `## SECTION RULES

PROFILE SUMMARY — 45 to 50 words. Count them, then rewrite if outside the range.
  Structure, in this exact order:
    a) One short clause of background (discipline + level, e.g. "Aerospace
       engineering graduate with two years in maintenance planning")
    b) Two or three interpersonal strengths, drawn from the JD's own wording
    c) Three or four hard skills or tools that the JD asks for
    d) Availability — LAST sentence, always. Use the candidate's availability
       line if given; if none is given, end with "Available immediately."
  No first-person pronouns. No banned words.

SKILLS — Interpersonal comes FIRST. This is deliberate: Airbus weighs
  behavioural fit heavily, so the reader must meet the interpersonal row before
  the technical one. Exactly three labelled rows in this order:
    1. Interpersonal & Communication — 4 to 6 skills, mirroring the JD's wording
    2. Technical & Analytical — tools, platforms, methods, software
    3. Domain & Languages — domain knowledge relevant to the JD + all languages

EXPERIENCE — Reverse chronological. Tailor each role title toward the JD only
  where the candidate's real title genuinely allows it; never promote a title.

PROJECTS — Reverse chronological. One line each, matched to JD keywords.

EDUCATION — Most recent first. Degree, institution, dates. No subject lists.

ACHIEVEMENTS / RECOGNITION — For each one, do NOT just name the award. Say in
  the same breath what the candidate contributed to earn it and what they took
  away from it. Maximum 16 words each, plain English.
  Shape: "<Award> — <what I did to earn it>; learned <skill or lesson>."
  Example: "Dean's List — led the 4-person structures project; learned to split
  work by deadline, not by preference."`;

const KEYWORDS_RULES = `### JD Keywords (15–20)
Comma-separated list of the most important keywords from the job description.
Mark each: ✓ if genuinely present in the candidate background, ✗ if not.
Do not mark ✓ to be generous — an honest ✗ tells the candidate what to fix.
Every ✓ keyword MUST appear somewhere in the resume body.`;

export function staticRules(format) {
  if (format === 'coverletter') {
    return `${COVER_RULES}

## OUTPUT FORMAT — follow exactly, no preamble, no commentary

${SCORING}

---

${KEYWORDS_RULES}

---

### COVER LETTER

[subject line]

[greeting]

[paragraph 1]

[paragraph 2]

[paragraph 3]

[paragraph 4]

[sign-off]
[candidate name]

Nothing after the name. Do not state the word count. Do not explain choices.`;
  }

  const head = `## YOUR ROLE
You are a professional resume writer. Given a job description (JD), you rewrite
the candidate's real history into a resume tailored to that JD.

## GOAL
Make the candidate the clearest possible match for this job. You may reshape
framing, choose which projects appear, and regroup skills. Output must pass
ATS keyword screening and read well to a human in under 30 seconds.

${WRITING_RULES}

${FACTS_FIGURES}

${SECTION_RULES}`;

  if (format === 'standard') {
    return `${head}

## OUTPUT — all sections, in this order, markdown, no preamble

---

${SCORING}

---

${KEYWORDS_RULES}

---

**PROFILE SUMMARY**
[45–50 words, ending with the availability sentence]

---

**SKILLS**
**Interpersonal & Communication:** ...
**Technical & Analytical:** ...
**Domain & Languages:** ...

---

**EXPERIENCE**

[Role title | Company, Location | Dates]
- [bullet <=26 words]
- [bullet <=26 words]

---

**RELEVANT PROJECTS**
- **[Name]** | [Org] | [Date] — [description <=18 words]

---

**EDUCATION**
**[Degree]** | [Institution] | [Dates]

---

**ACHIEVEMENTS**
- [<=16 words: what I did to earn it; what I learned]`;
  }

  // Both LaTeX variants share the compile-safety and one-page rules.
  const latexCommon = `## OUTPUT ORDER
Print the likelihood line, then the JD Keywords line, then the LaTeX document.
No explanation before or after. Nothing between \\end{document} and the end.

${SCORING}

---

${KEYWORDS_RULES}

---

## ONE-PAGE ENFORCEMENT

The resume MUST fit exactly one A4 page. This is non-negotiable.
Font 10pt base — never larger. Bullet itemsep/parsep/topsep = 0pt.
Parskip 0pt. At most 1pt of vertical space between entries.

If it still overflows, cut in this strict order:
  1. Trim project descriptions to one clause (<=10 words)
  2. Drop the least JD-relevant project
  3. Trim each achievement to <=12 words
  4. Reduce bullets to <=18 words
  5. Drop the least relevant bullet from the least relevant role
NEVER cut: any experience role, any education entry, the skills block, the summary.
NEVER run onto a second page.

## LATEX SAFETY

Escape these characters in all candidate text: & % $ # _ { } ~ ^
Write them as \\& \\% \\$ \\# \\_ \\{ \\} \\textasciitilde{} \\textasciicircum{}
Use only ASCII quotes and hyphens. Replace any en/em dash with --.
No \\includegraphics, no icons, no photos, no colour beyond black.
Output must compile in pdfLaTeX on Overleaf with zero errors on the first try.
No text before \\documentclass. No text after \\end{document}.`;

  if (format === 'latex2col') {
    return `${head}

${latexCommon}

## LAYOUT — TWO COLUMN

A narrow left column and a wide right column, built with two \\minipage blocks
(no multicol, no tabular for layout). The header spans the full width above both.

LEFT COLUMN (0.31 of text width), in this exact order:
  Interpersonal Skills   <- first, above technical, always
  Technical Skills
  Domain & Languages
  Education
RIGHT COLUMN (0.65 of text width), in this exact order:
  Profile
  Experience
  Projects
  Achievements

Warning: a two-column CV can confuse some ATS parsers. Keep every line as plain
running text inside its minipage — no nested tables, no text boxes.

Follow this skeleton exactly, replacing the comments with real content:

\\documentclass[10pt,a4paper]{article}
\\usepackage[top=0.45in,bottom=0.45in,left=0.5in,right=0.5in]{geometry}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{microtype}
\\usepackage{enumitem}
\\usepackage{titlesec}
\\usepackage{hyperref}
\\usepackage{parskip}
\\hypersetup{colorlinks=true,urlcolor=black,linkcolor=black}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0pt}
\\titleformat{\\section}{\\vspace{-8pt}\\scshape\\raggedright\\normalsize\\bfseries}{}{0em}{}[\\titlerule\\vspace{-8pt}]
\\setlist[itemize]{leftmargin=*,topsep=0pt,itemsep=0pt,parsep=0pt,label=\\textbullet}
\\begin{document}
\\pagestyle{empty}

\\begin{center}
  {\\LARGE \\textbf{Full Name}} \\\\[2pt]
  Role Title Matched To The JD \\\\[2pt]
  {\\small email | phone | location | linkedin}
\\end{center}
\\vspace{4pt}

\\noindent
\\begin{minipage}[t]{0.31\\textwidth}
  \\section*{Interpersonal Skills}
  % 4-6 plain-English interpersonal skills, one per line
  \\section*{Technical Skills}
  % tools, platforms, methods
  \\section*{Domain \\& Languages}
  % domain knowledge + every language with level
  \\section*{Education}
  % \\textbf{Degree} \\\\ Institution \\\\ Dates
\\end{minipage}
\\hfill
\\begin{minipage}[t]{0.65\\textwidth}
  \\section*{Profile}
  % 45-50 words, availability sentence last
  \\section*{Experience}
  % \\textbf{Role} | Company, Location \\hfill Dates
  % \\begin{itemize} \\item ... \\end{itemize}
  \\section*{Projects}
  % \\textbf{Name} | Org \\hfill Date \\\\ one-line description
  \\section*{Achievements}
  % \\begin{itemize} \\item what I did; what I learned \\end{itemize}
\\end{minipage}

\\end{document}`;
  }

  // Single column (default LaTeX)
  return `${head}

${latexCommon}

## LAYOUT — SINGLE COLUMN

Style: Jake Ryan / Harvard OCS. Clean single column, small-caps ruled headers.
ATS-safest option: no tables, no columns, standard headings only.

SECTION ORDER: Header, Summary, Skills, Experience, Projects, Education, Achievements.
Inside Skills, the Interpersonal row comes first, before Technical.
HEADER: centred. Name large and bold, role title below, contact line below that.

Follow this skeleton exactly, replacing the comments with real content:

\\documentclass[10pt,a4paper]{article}
\\usepackage[top=0.45in,bottom=0.45in,left=0.55in,right=0.55in]{geometry}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{microtype}
\\usepackage{enumitem}
\\usepackage{titlesec}
\\usepackage{hyperref}
\\usepackage{parskip}
\\hypersetup{colorlinks=true,urlcolor=black,linkcolor=black}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0pt}
\\titleformat{\\section}{\\vspace{-10pt}\\scshape\\raggedright\\large}{}{0em}{}[\\titlerule\\vspace{-10pt}]
\\setlist[itemize]{leftmargin=*,topsep=0pt,itemsep=0pt,parsep=0pt,label=\\textbullet}
\\begin{document}
\\pagestyle{empty}

\\begin{center}
  {\\Large \\textbf{Full Name}} \\\\[2pt]
  Role Title Matched To The JD \\\\[2pt]
  email | phone | location | linkedin
\\end{center}

\\section{Summary}
% 45-50 words, availability sentence last

\\section{Skills}
\\textbf{Interpersonal \\& Communication:} ... \\\\
\\textbf{Technical \\& Analytical:} ... \\\\
\\textbf{Domain \\& Languages:} ...

\\section{Experience}
% \\textbf{Role} | Company, Location \\hfill Dates
% \\begin{itemize} \\item ... \\end{itemize}

\\section{Projects}
% \\textbf{Name} | Org \\hfill Date \\\\ one-line description

\\section{Education}
% \\textbf{Degree} | Institution \\hfill Dates

\\section{Achievements}
% \\begin{itemize} \\item what I did; what I learned \\end{itemize}

\\end{document}`;
}

// ─────────────────────────────────────────────
// BLOCK 2 — candidate data. Stable per user across every job application,
// so it also sits behind a cache breakpoint. Only the JD is charged in full.
// ─────────────────────────────────────────────
export function buildCandidateBlock(profile, prefs) {
  if (!profile || !profile.name) {
    return `NO CANDIDATE PROFILE PROVIDED.
Reply with exactly one line asking the user to click the avatar icon in the
top-right corner of the app to set up their profile.`;
  }

  const edu = (profile.education || [])
    .map(e => `${e.degree} | ${e.institution} | ${e.dates}`)
    .join('\n') || 'Not provided';

  const bulletCounts = prefs?.bulletCounts || [];

  const exp = (profile.experience || [])
    .map((e, i) => {
      const n = bulletCounts[i] || 3;
      const pool = (e.bullets || []).map((b, j) => `${j + 1}. ${b}`).join('\n');
      const instruction = pool
        ? `Select and rewrite the bullet pool below into exactly ${n} bullet${n === 1 ? '' : 's'} tailored to the JD. Merge, split, reorder and reword freely; keep every underlying claim true. Follow the WHAT I DID / WHY IT MATTERED / WHICH SKILL shape.`
        : `Write exactly ${n} bullet${n === 1 ? '' : 's'} inferred from the role title and company alone. Stay generic rather than inventing specific duties.`;
      return `[ROLE ${i + 1}]
${e.title} | ${e.company}, ${e.location} | ${e.dates}
${instruction}
${pool || '(No bullets provided)'}`;
    })
    .join('\n\n') || 'Not provided';

  const maxProjects = prefs?.projectCount ?? 3;
  const projects = (profile.projects || [])
    .map((p, i) => `P${i + 1}. ${p.name} | ${p.org} | ${p.dates} | ${p.keywords}`)
    .join('\n') || 'Not provided';

  const achievements = (profile.achievements || [])
    .map(a => `- ${a.text}`)
    .join('\n') || 'Not provided';

  const extras = (prefs?.extraSections || []);

  return `══════════════════════════════════════════
CANDIDATE DATA — facts here are fixed
══════════════════════════════════════════

Name: ${profile.name}
${profile.email ? `Email: ${profile.email}` : ''}
${profile.phone ? `Phone: ${profile.phone}` : ''}
${profile.location ? `Location: ${profile.location}` : ''}
${profile.linkedin ? `LinkedIn: ${profile.linkedin}` : ''}
Availability: ${profile.availability || 'Not stated — end the summary with "Available immediately."'}

── EDUCATION ──
${edu}

── EXPERIENCE ──
${exp}

── PROJECTS ──
Choose exactly ${maxProjects}, the most JD-relevant, from:
${projects}

── TECHNICAL SKILLS POOL ──
${profile.skills || 'Not provided'}

── INTERPERSONAL SKILLS POOL ──
${profile.softSkills || 'Not explicitly provided — infer honestly from the experience bullets above and mirror the JD wording.'}

── ACHIEVEMENTS / RECOGNITION ──
${achievements}

── LANGUAGES ──
${profile.languages || 'Not provided'}
${extras.length ? `
── EXTRA SECTIONS (add each after Achievements, in this order) ──
${extras.map((s, i) => `${i + 1}. ${s.title}: ${s.content}`).join('\n')}` : ''}`;
}

// ─────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────
export default async function handler(req, res) {
  if (preflight(req, res)) return;

  const { jd, format: rawFormat, profile: rawProfile, lockedScore: rawLocked, prefs: rawPrefs } = req.body || {};

  const jdClean = typeof jd === 'string' ? jd.trim().slice(0, 8000) : '';
  if (jdClean.length < 20)
    return res.status(400).json({ error: 'Please provide a valid job description.' });

  const format = ['standard', 'latex', 'latex2col', 'coverletter'].includes(rawFormat) ? rawFormat : 'standard';
  const profile = sanitizeProfile(rawProfile);
  const prefs   = sanitizePrefs(rawPrefs);

  // lockedScore comes from the browser and is interpolated into the prompt,
  // so it is validated to the shape we expect rather than passed through.
  const lockedScore = /^\d{1,3}%$/.test(String(rawLocked || '')) ? String(rawLocked) : null;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey)
    return res.status(500).json({ error: 'API key not configured. Contact the site owner.' });

  try {
    // Two cache breakpoints. Block 0 is identical for every user at this
    // format; block 1 is identical for one user across every job they apply
    // to. Only the JD in `messages` is billed at the full input rate.
    const system = [
      { type: 'text', text: staticRules(format),                  cache_control: { type: 'ephemeral' } },
      { type: 'text', text: buildCandidateBlock(profile, prefs),   cache_control: { type: 'ephemeral' } },
    ];

    // The cover letter's target length rides in the user message rather than
    // the system prompt, so changing it does not invalidate the cached prefix.
    const lengthLine = format === 'coverletter'
      ? `\n\nTARGET LENGTH: ${prefs.coverWords} words in the letter body (greeting, subject line and sign-off do not count). Stay within 5% of this.`
      : '';

    const userMsg = `Here is the job description:\n\n${jdClean}`
      + lengthLine
      + (lockedScore
        ? `\n\nIMPORTANT: The interview likelihood score is locked at ${lockedScore}. Output exactly this score — do not recalculate it.`
        : '');

    const { text, usage, ms } = await callClaude({
      apiKey,
      model: MODELS.generate,
      effort: EFFORT.generate,
      thinking: 'adaptive',
      // A 500-word letter needs far less room than a full LaTeX document.
      maxTokens: format === 'coverletter' ? 3000
               : format === 'standard'    ? 4000
               :                            6000,
      system,
      messages: [{ role: 'user', content: userMsg }],
    });

    await logUsage("generate", usage, { format, jdChars: jdClean.length, ms });

    return res.status(200).json({ content: text, usage, ms });

  } catch (err) {
    console.error('Generate error:', err.status || '', err.message, err.upstream || '');
    const status = err.status && err.status >= 400 ? err.status : 500;
    return res.status(status).json({ error: friendlyError(status) });
  }
}
