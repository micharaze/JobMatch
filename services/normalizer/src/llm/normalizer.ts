import { llm, MODEL, IS_OLLAMA, KEEP_ALIVE, type OllamaParams } from './client';
import logger from '../logger';

const TEMPERATURE = 0.1;

// ── System prompts ────────────────────────────────────────────────────────────

const JOB_SYSTEM_PROMPT = `You are a technical job posting summarizer for a recruiting tool.
Convert the given job posting into a compact structured profile.

REMOVE: company descriptions, mission statements, benefits, perks, salary, EEO disclaimers, and application instructions.
KEEP: all technical requirements, project description, team context, work model, domain details.

Output this exact markdown format:
## Job: [Job Title] @ [Company Name]
**Level:** [inferred seniority and years required, e.g. "Senior (5+ yrs)"]
**Required:** [comma-separated required technical skills, include version or experience years if stated]
**Preferred:** [comma-separated preferred/nice-to-have skills]
**Domain:** [2-5 key technical domain areas, e.g. "SPA architecture, CI/CD, REST APIs"]
**Project context:** [1-2 sentences: project type, team size, remote/onsite, contract length]
**Industry:** [industry if relevant, e.g. "Fintech, healthcare" — omit this line if not mentioned]

Rules:
- Use the posting's own required/preferred language to classify skills
- Keep skill names concise ("Vue.js 3" not "Vue.js version 3 framework")
- Output ONLY the markdown block, nothing else`;

const CV_SYSTEM_PROMPT = `You are a CV summarizer for a recruiting tool.
Convert the given CV into a compact structured skills profile with temporal context.

Group skills by recency based on the work history timeline in the CV.

Output this exact markdown format:
## CV: [First name + last initial only] — [current or most recent role]
**Level:** [inferred seniority, e.g. "Senior (8+ yrs)"]
**Active ([most recent 2-3 yr range, e.g. 2022–now]):** [skills actively used in recent positions]
**Solid ([middle range, e.g. 2019–2022]):** [skills used regularly but not in the most recent years]
**Past ([older range or "pre-YEAR"]):** [skills from older positions or barely mentioned]
**Workflow:** [PM tools, version control, CI/CD, e.g. "Jira, Git, GitHub Actions"]
**Domain:** [2-4 specialisation areas, e.g. "Full-stack web, API design, freelance consulting"]

Rules:
- Infer year ranges from job entries in the work history
- If no dates are present, use "Primary" / "Secondary" / "Mentioned briefly" instead of date ranges
- Omit the "Past" line if no outdated skills exist
- Skills appearing only in older positions and not in recent ones go in "Past"
- Note freelancer/contractor status in the title line
- Output ONLY the markdown block, nothing else`;

// ── Main function ─────────────────────────────────────────────────────────────

export async function normalize(
  text:  string,
  type:  'job_posting' | 'cv',
): Promise<string> {
  const systemPrompt = type === 'job_posting' ? JOB_SYSTEM_PROMPT : CV_SYSTEM_PROMPT;
  const userContent  = type === 'job_posting'
    ? `Convert this job posting:\n\n${text}`
    : `Convert this CV:\n\n${text}`;

  const response = await llm.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userContent  },
    ],
    temperature: TEMPERATURE,
    max_tokens:  500,
    ...(IS_OLLAMA && { keep_alive: KEEP_ALIVE }),
  } as OllamaParams);

  const raw    = (response.choices[0]?.message?.content ?? '').trim();
  // Strip <thought>...</thought> blocks emitted by extended-thinking models
  const output = raw.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();

  if (output.length < 80 || !output.includes('##')) {
    throw new Error(
      `Normalizer returned invalid output (${output.length} chars): ${output.slice(0, 120)}`,
    );
  }

  logger.debug('Normalization complete', { type, chars: output.length });
  return output;
}
