#!/usr/bin/env node
/**
 * Stress test: which model should write the CV?
 *
 * Runs the SAME production prompt (imported from api/generate.js, not a copy)
 * through several model + effort combinations, then scores each output against
 * the Airbus rules and prints cost, latency and quality side by side.
 *
 *   set ANTHROPIC_API_KEY=sk-ant-...
 *   node scripts/stress-test.mjs
 *
 * Options
 *   --profile <file.json>  your real profile. In the app, open the browser
 *                          console and run:  copy(localStorage.tailorit_profile)
 *                          then paste into a file. Defaults to a built-in sample.
 *   --jd <file.txt>        the job description. Defaults to a sample Airbus JD.
 *   --format <f>           standard | latex | latex2col       (default standard)
 *   --runs <n>             repeats per config, to see variance (default 1)
 *   --configs <list>       comma-separated model:effort pairs, e.g.
 *                          "claude-opus-5:medium,claude-sonnet-5:medium"
 *   --out <dir>            where to write the full outputs (default ./stress-out)
 *
 * Every run costs real money. Four configs on one JD is roughly $0.10-0.20.
 */

import fs from 'node:fs';
import path from 'node:path';
import { staticRules, buildCandidateBlock, sanitizeProfile, sanitizePrefs } from '../api/generate.js';
import { callClaude, costOf } from '../api/_lib.js';

// ── args ──
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const FORMAT   = arg('format', 'standard');
const RUNS     = parseInt(arg('runs', '1'), 10);
const OUTDIR   = arg('out', 'stress-out');
const CONFIGS  = arg('configs',
  'claude-opus-5:medium,claude-sonnet-5:medium,claude-opus-5:low,claude-sonnet-4-6:medium'
).split(',').map(s => {
  const [model, effort = 'medium'] = s.trim().split(':');
  return { model, effort };
});

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set. Export it first, then re-run.');
  process.exit(1);
}

// ── fixtures ──
const SAMPLE_PROFILE = {
  name: 'Sample Candidate',
  email: 'sample@example.com',
  phone: '+33 600000000',
  location: 'Toulouse, France',
  availability: 'Available from March 2026',
  skills: 'Python, Power BI, Excel, SAP-MM, CATIA V5, MATLAB, CS-25, EASA Part-21',
  softSkills: 'Cross-team coordination, written handovers, supplier communication, mentoring',
  languages: 'English (C1), French (B1), Hindi (Native)',
  education: [{ degree: 'MSc Aerospace Engineering', institution: 'ENAC Toulouse', dates: '2022 – 2024' }],
  experience: [
    {
      title: 'Structures Intern', company: 'Aerospace Supplier Ltd', location: 'Toulouse, France',
      dates: 'Jun 2023 – Dec 2023',
      bullets: [
        'Supported the wing stress team by preparing load case inputs for fatigue checks',
        'Built a parts tracking sheet in Excel used by the line team each week',
        'Presented weekly status updates to the team lead and two suppliers',
        'Checked incoming drawings against CS-25 requirements and logged deviations',
      ],
    },
    {
      title: 'Maintenance Planning Assistant', company: 'Regional Airline', location: 'Delhi, India',
      dates: 'Jul 2021 – Aug 2022',
      bullets: [
        'Scheduled line maintenance slots for a fleet of narrow body aircraft',
        'Coordinated spare part requests with stores using SAP-MM',
        'Wrote handover notes between shifts to reduce repeated work',
      ],
    },
  ],
  projects: [
    { name: 'Drone Aerodynamics Study', org: 'ENAC', dates: '2023', keywords: 'CFD, OpenFOAM, wind tunnel validation' },
    { name: 'Fleet Delay Dashboard', org: 'Personal', dates: '2022', keywords: 'Python, Power BI, operational data' },
  ],
  achievements: [
    "Dean's List, ENAC 2023",
    'Won internal hackathon for a maintenance scheduling tool',
  ],
};

const SAMPLE_JD = `Airbus - Industrial Planning Engineer (Toulouse, France)

You will join the Final Assembly Line planning team. You will prepare and follow
production schedules, work with the shop floor and with suppliers, and help
solve day to day industrial problems.

Responsibilities:
- Build and maintain production schedules for assembly stations
- Work closely with quality, logistics and design teams to unblock issues
- Track parts availability and escalate shortages early
- Produce clear reporting for management on schedule adherence

Required:
- Engineering degree, aerospace or industrial
- Experience with production planning or maintenance planning
- SAP knowledge, strong Excel, data visualisation (Power BI or similar)
- Good communication skills, able to work with many teams
- English mandatory, French desirable

We value teamwork, clear communication and the ability to explain problems simply.`;

const profileRaw = arg('profile') ? JSON.parse(fs.readFileSync(arg('profile'), 'utf8')) : SAMPLE_PROFILE;
const jd = arg('jd') ? fs.readFileSync(arg('jd'), 'utf8') : SAMPLE_JD;

const profile = sanitizeProfile(profileRaw);
const prefs   = sanitizePrefs(profileRaw.prefs || { bulletCounts: [], projectCount: 2, extraSections: [] });

// ─────────────────────────────────────────────
// QUALITY CHECKS
// ─────────────────────────────────────────────
const BANNED = ['leverage','leveraged','leveraging','synergy','synergies','spearhead','spearheaded',
  'orchestrate','orchestrated','robust','dynamic','passionate','results-driven','seasoned','holistic',
  'cutting-edge','best-in-class','utilise','utilize','utilised','utilized','facilitate','facilitated',
  'myriad','plethora','stakeholder-centric'];

const words = s => s.trim().split(/\s+/).filter(Boolean);

function extractSummary(text) {
  // Works for both the markdown output and the LaTeX \section{Summary}.
  const md = text.match(/\*\*PROFILE SUMMARY\*\*\s*\n+([\s\S]*?)(?:\n\s*---|\n\s*\*\*)/i);
  if (md) return md[1].trim();
  const tex = text.match(/\\section\*?\{Summary\}([\s\S]*?)(?:\\section|\\end\{minipage\})/i);
  if (tex) return tex[1].replace(/\\\\/g, ' ').replace(/%.*$/gm, '').trim();
  return '';
}

function extractBullets(text) {
  const md = [...text.matchAll(/^\s*-\s+(.{10,})$/gm)].map(m => m[1].trim());
  const tex = [...text.matchAll(/\\item\s+(.{10,}?)(?=\n|\\item|\\end)/g)].map(m => m[1].trim());
  return (md.length >= tex.length ? md : tex)
    .filter(b => !/^\*\*.+\*\*\s*\|/.test(b));   // drop project lines
}

const COVER_WORDS = parseInt(arg('words', '250'), 10);

function scoreCover(text) {
  const body = text.replace(/^[\s\S]*?###\s*COVER LETTER\s*/i, '').replace(/^---+\s*$/gm, '').trim();
  const blocks = body.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const counted = blocks.slice(1)
    .filter(b => !/^(dear\b|yours\s|kind regards|best regards|sincerely)/i.test(b))
    .join(' ');
  const wc = words(counted).length;
  const banned = BANNED.filter(w => new RegExp('\\b' + w.replace(/[-]/g, '[- ]') + '\\b', 'i').test(body));
  const all = words(body.replace(/[^A-Za-z .]/g, ' '));

  const checks = {
    letterWords: wc,
    // Within 10% of target is the bar; the prompt asks for 5%.
    lengthOnTarget: Math.abs(wc - COVER_WORDS) <= Math.max(12, COVER_WORDS * 0.10),
    hasSubject: /^application for/i.test(blocks[0] || ''),
    hasGreeting: blocks.some(b => /^dear\s/i.test(b)),
    hasSignOff: blocks.some(b => /^(yours sincerely|yours faithfully|kind regards)/i.test(b)),
    noBullets: !/^\s*[-*•]\s+/m.test(body),
    noToWhom: !/to whom it may concern/i.test(body),
    notOpeningCliche: !/^i am writing to apply/i.test(blocks[2] || blocks[1] || ''),
    mentionsAvailability: /available|availability|notice period/i.test(body),
    bannedWords: banned,
    longWordPct: all.length ? +(all.filter(w => w.length >= 11).length / all.length * 100).toFixed(1) : 0,
    hasScoreLine: /\d{1,3}\s*%/.test(text),
  };
  checks.noBannedWords = banned.length === 0;

  const bools = Object.entries(checks).filter(([, v]) => typeof v === 'boolean');
  const passed = bools.filter(([, v]) => v).length;
  checks.pass = `${passed}/${bools.length}`;
  checks.passPct = Math.round(passed / bools.length * 100);
  // Fields the shared report expects.
  checks.summaryWords = wc;
  checks.summaryInRange = checks.lengthOnTarget;
  checks.bulletsOver26 = 0;
  checks.interpersonalFirst = true;
  return checks;
}

function score(text) {
  if (FORMAT === 'coverletter') return scoreCover(text);
  const lower = text.toLowerCase();
  const summary = extractSummary(text);
  const sw = summary ? words(summary).length : 0;
  const bullets = extractBullets(text);
  const bulletLens = bullets.map(b => words(b).length);
  const overLong = bulletLens.filter(n => n > 26).length;

  const iIdx = lower.search(/interpersonal/);
  const tIdx = lower.search(/technical\s*(&|\\&|and)?\s*analytical|technical skills/);

  const banned = BANNED.filter(w => new RegExp('\\b' + w.replace(/[-]/g, '[- ]') + '\\b', 'i').test(text));

  // Plain-English proxy: share of long words, and words per sentence.
  const all = words(text.replace(/[^A-Za-z .]/g, ' '));
  const longWordPct = all.length ? +(all.filter(w => w.length >= 11).length / all.length * 100).toFixed(1) : 0;

  const checks = {
    summaryWords: sw,
    summaryInRange: sw >= 45 && sw <= 50,
    availabilityLast: /available|availability|notice/i.test(summary.split(/(?<=\.)\s+/).slice(-1)[0] || ''),
    bulletCount: bullets.length,
    bulletsOver26: overLong,
    avgBulletWords: bulletLens.length ? +(bulletLens.reduce((a,b)=>a+b,0)/bulletLens.length).toFixed(1) : 0,
    interpersonalFirst: iIdx !== -1 && (tIdx === -1 || iIdx < tIdx),
    bannedWords: banned,
    longWordPct,
    hasScoreLine: /\d{1,3}\s*%/.test(text),
    hasKeywords: /✓|✗/.test(text),
  };

  if (FORMAT !== 'standard') {
    const open = (text.match(/\{/g) || []).length;
    const close = (text.match(/\}/g) || []).length;
    checks.latexComplete = text.includes('\\documentclass') && text.includes('\\end{document}');
    checks.bracesBalanced = open === close;
    if (FORMAT === 'latex2col') checks.twoMinipages = (text.match(/\\begin\{minipage\}/g) || []).length === 2;
  }

  // Headline pass rate over the checks that are pass/fail.
  const bools = Object.entries(checks).filter(([k, v]) => typeof v === 'boolean');
  const passed = bools.filter(([, v]) => v).length;
  checks.pass = `${passed}/${bools.length}`;
  checks.passPct = Math.round(passed / bools.length * 100);
  return checks;
}

// --selftest checks the grader against a known-good and known-bad output, so
// you can trust the numbers before spending anything on real runs.
if (argv.includes('--selftest')) {
  const good = `### Likelihood of Getting an Interview
78% — strong planning overlap; French only B1

---

### JD Keywords
production planning ✓, SAP ✓, Power BI ✓, French ✗

---

**PROFILE SUMMARY**

Aerospace engineering graduate with two years of hands-on maintenance and production planning experience. Works easily across shop floor, quality, logistics and supplier teams, and writes clear shift handovers that other people can act on. Skilled in SAP-MM, Power BI, Excel and assembly line schedule tracking. Available from March 2026.

---

**SKILLS**
**Interpersonal & Communication:** cross-team coordination, supplier communication, written handovers, mentoring
**Technical & Analytical:** SAP-MM, Power BI, Excel, CATIA V5
**Domain & Languages:** CS-25, EASA Part-21; English C1, French B1, Hindi native

---

**EXPERIENCE**

Structures Intern | Aerospace Supplier Ltd, Toulouse | Jun 2023 – Dec 2023
- Prepared load case inputs for the wing stress team so fatigue checks stayed on schedule, which taught me to read structural requirements carefully.
- Built a weekly parts tracking sheet in Excel that the line team used to spot delays early, sharpening my reporting skills.`;

  const bad = good
    .replace('Available from March 2026.', 'Passionate and results-driven engineer seeking growth.')
    .replace('**Interpersonal & Communication:**', '**ZZTechnical & Analytical:**')
    .replace('**Technical & Analytical:**', '**Interpersonal & Communication:**')
    .replace('Prepared load case inputs for the wing stress team so fatigue checks stayed on schedule, which taught me to read structural requirements carefully.',
      'Leveraged robust synergies to facilitate a holistic and cutting-edge approach that spearheaded the utilisation of best-in-class dynamic planning methods across every single one of the many teams involved.');

  const g = score(good), b = score(bad);
  const line = (n, v) => `  ${n.padEnd(22)} good=${String(v(g)).padEnd(14)} bad=${v(b)}`;
  console.log('\nGRADER SELF-TEST');
  console.log(line('summaryWords',       x => x.summaryWords + (x.summaryInRange ? ' (in range)' : ' (out)')));
  console.log(line('availabilityLast',   x => x.availabilityLast));
  console.log(line('interpersonalFirst', x => x.interpersonalFirst));
  console.log(line('bulletsOver26',      x => x.bulletsOver26));
  console.log(line('bannedWords',        x => x.bannedWords.length));
  console.log(line('overall',            x => x.passPct + '%'));
  const sane = g.passPct > b.passPct && g.summaryInRange && g.interpersonalFirst
            && !b.interpersonalFirst && b.bannedWords.length > 0 && b.bulletsOver26 > 0;
  console.log(sane ? '\n  PASS — the grader separates good from bad.\n'
                   : '\n  FAIL — the grader is not discriminating; fix it before trusting scores.\n');
  process.exit(sane ? 0 : 1);
}

// ─────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────
const system = [
  { type: 'text', text: staticRules(FORMAT),                 cache_control: { type: 'ephemeral' } },
  { type: 'text', text: buildCandidateBlock(profile, prefs), cache_control: { type: 'ephemeral' } },
];

fs.mkdirSync(OUTDIR, { recursive: true });

console.log(`\nFormat: ${FORMAT}   Runs per config: ${RUNS}   Configs: ${CONFIGS.length}`);
console.log(`Candidate: ${profile.name}   Roles: ${profile.experience.length}\n`);

const rows = [];

for (const cfg of CONFIGS) {
  for (let r = 1; r <= RUNS; r++) {
    const tag = `${cfg.model}:${cfg.effort}${RUNS > 1 ? '#' + r : ''}`;
    process.stdout.write(`running ${tag} … `);
    try {
      const { text, usage, ms } = await callClaude({
        apiKey: API_KEY,
        model: cfg.model,
        effort: cfg.effort,
        thinking: 'adaptive',
        maxTokens: FORMAT === 'coverletter' ? 3000 : FORMAT === 'standard' ? 4000 : 6000,
        system,
        messages: [{
          role: 'user',
          content: `Here is the job description:\n\n${jd}` + (FORMAT === 'coverletter'
            ? `\n\nTARGET LENGTH: ${COVER_WORDS} words in the letter body (greeting, subject line and sign-off do not count). Stay within 5% of this.`
            : ''),
        }],
      });

      const q = score(text);
      const file = path.join(OUTDIR, `${cfg.model}_${cfg.effort}${RUNS > 1 ? '_' + r : ''}.txt`);
      fs.writeFileSync(file, text);

      rows.push({ tag, usage, ms, q, file });
      console.log(`${q.passPct}%  $${(usage.usd ?? 0).toFixed(4)}  ${(ms/1000).toFixed(1)}s`);
    } catch (err) {
      console.log(`FAILED — ${err.message}`);
      rows.push({ tag, error: err.message });
    }
  }
}

// ── report ──
const ok = rows.filter(r => !r.error);
if (!ok.length) { console.error('\nEvery run failed.'); process.exit(1); }

const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

console.log('\n' + '═'.repeat(104));
console.log(pad('CONFIG', 26) + rpad('QUALITY', 9) + rpad('SUMMARY', 9) + rpad('BULLET>26', 11)
  + rpad('BANNED', 8) + rpad('INTER-1ST', 11) + rpad('COST', 10) + rpad('TOK IN/OUT', 14) + rpad('SEC', 6));
console.log('─'.repeat(104));
for (const r of ok) {
  console.log(
    pad(r.tag, 26)
    + rpad(r.q.passPct + '%', 9)
    + rpad(r.q.summaryWords + (r.q.summaryInRange ? ' ok' : ' XX'), 9)
    + rpad(r.q.bulletsOver26, 11)
    + rpad(r.q.bannedWords.length, 8)
    + rpad(r.q.interpersonalFirst ? 'yes' : 'NO', 11)
    + rpad('$' + (r.usage.usd ?? 0).toFixed(4), 10)
    + rpad(`${r.usage.inputTokens}/${r.usage.outputTokens}`, 14)
    + rpad((r.ms / 1000).toFixed(1), 6)
  );
}
console.log('═'.repeat(104));

// Average by config, so repeated runs collapse into one line.
const byCfg = new Map();
for (const r of ok) {
  const key = r.tag.split('#')[0];
  if (!byCfg.has(key)) byCfg.set(key, []);
  byCfg.get(key).push(r);
}

const ranked = [...byCfg.entries()].map(([key, list]) => ({
  key,
  quality: list.reduce((a, r) => a + r.q.passPct, 0) / list.length,
  cost:    list.reduce((a, r) => a + (r.usage.usd ?? 0), 0) / list.length,
  secs:    list.reduce((a, r) => a + r.ms, 0) / list.length / 1000,
})).sort((a, b) => b.quality - a.quality || a.cost - b.cost);

console.log('\nRANKED BY QUALITY');
ranked.forEach((r, i) => console.log(
  `  ${i + 1}. ${pad(r.key, 28)} quality ${r.quality.toFixed(0)}%   $${r.cost.toFixed(4)}/CV   ${r.secs.toFixed(1)}s`
));

const best = ranked[0];
const cheapestGood = ranked.filter(r => r.quality >= best.quality - 5).sort((a, b) => a.cost - b.cost)[0];

console.log(`\nBest quality : ${best.key}`);
if (cheapestGood.key !== best.key)
  console.log(`Best value   : ${cheapestGood.key} — within 5 points of the top at $${cheapestGood.cost.toFixed(4)}/CV`);
console.log(`\nSet the winner in Vercel:  GENERATE_MODEL=${best.key.split(':')[0]}  GENERATE_EFFORT=${best.key.split(':')[1]}`);
console.log(`Full outputs written to ./${OUTDIR}/ — read them before trusting the score.\n`);

// Detail on anything that failed a check, so the number is explainable.
for (const r of ok) {
  const issues = [];
  if (!r.q.summaryInRange)     issues.push(`summary ${r.q.summaryWords} words (want 45-50)`);
  if (!r.q.availabilityLast)   issues.push('availability not in the last sentence');
  if (!r.q.interpersonalFirst) issues.push('interpersonal NOT above technical');
  if (r.q.bulletsOver26)       issues.push(`${r.q.bulletsOver26} bullets over 26 words`);
  if (r.q.bannedWords.length)  issues.push('banned: ' + r.q.bannedWords.join(', '));
  if (r.q.latexComplete === false)  issues.push('LaTeX incomplete');
  if (r.q.bracesBalanced === false) issues.push('unbalanced braces');
  if (r.q.twoMinipages === false)   issues.push('not two minipages');
  if (issues.length) console.log(`  ${r.tag}: ${issues.join('; ')}`);
}
console.log();
