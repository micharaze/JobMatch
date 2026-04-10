import { llm, MODEL, IS_OLLAMA, KEEP_ALIVE, type OllamaParams } from './client';
import type { MatchResult } from '@jobcheck/shared';
import logger from '../logger';

const TEMPERATURE = 0.1;

const SYSTEM_PROMPT = `You are a technical recruiter scoring a candidate CV against a job posting.
You will receive a normalized job profile and a normalized CV profile.

Scoring rules:
- Score 70+ only if the candidate clearly meets most required skills AND those skills are current/active.
- Skills listed as "Past" or in older date ranges count at half weight — treat as background knowledge, not active proficiency.
- React ≠ Angular, Vue.js ≠ Angular, Python ≠ Java. These are NOT interchangeable without significant retraining.
- "Adjacent" means related but not the same — note the gap, do NOT count it as matched.
- If the CV shows deep domain experience matching the job's project context (e.g. both in fintech, both greenfield SPAs), add up to 10 bonus points.

Score bands:
0–40:  significant skill gaps
41–65: partial match — some relevant skills but key gaps
66–80: solid match — meets most requirements
81–100: strong match — meets almost all requirements with relevant experience`;

interface MatchLlmOutput {
  score:    number;
  summary:  string;
  matched:  string[];
  missing:  string[];
  adjacent: string[];
}

function validateOutput(raw: unknown): MatchLlmOutput {
  if (typeof raw !== 'object' || raw === null) throw new Error('LLM output is not an object');
  const obj     = raw as Record<string, unknown>;
  const score   = Number(obj['score']);

  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error(`Invalid score value: ${String(obj['score'])}`);
  }

  const summary = typeof obj['summary'] === 'string' && obj['summary'].trim().length > 0
    ? obj['summary'].trim()
    : null;
  if (!summary) throw new Error('Missing or empty summary field');

  const toStringArray = (v: unknown): string[] =>
    Array.isArray(v)
      ? (v as unknown[]).filter((s): s is string => typeof s === 'string')
      : [];

  return {
    score:    Math.round(Math.max(0, Math.min(100, score))),
    summary,
    matched:  toStringArray(obj['matched']),
    missing:  toStringArray(obj['missing']),
    adjacent: toStringArray(obj['adjacent']),
  };
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function matchCvToJob(
  postingId:     string,
  cvId:          string,
  normalizedJob: string,
  normalizedCv:  string,
): Promise<MatchResult> {
  const userContent = [
    'JOB:',
    normalizedJob,
    '',
    'CV:',
    normalizedCv,
    '',
    'Respond with JSON only:',
    '{',
    '  "score": <0-100>,',
    '  "summary": "<2-3 sentence assessment>",',
    '  "matched": ["skill1", "skill2", ...],',
    '  "missing": ["skill1", "skill2", ...],',
    '  "adjacent": ["Vue.js → Angular: similar framework but not transferable without training", ...]',
    '}',
  ].join('\n');

  let rawContent: string | null = null;

  // Primary attempt with response_format: json_object
  try {
    const response = await llm.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userContent   },
      ],
      response_format: { type: 'json_object' },
      temperature:     TEMPERATURE,
      ...(IS_OLLAMA && { keep_alive: KEEP_ALIVE }),
    } as OllamaParams);
    const raw  = response.choices[0]?.message?.content ?? null;
    rawContent = raw?.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim() ?? null;
  } catch (err) {
    logger.warn('Primary match attempt failed, retrying', {
      posting_id: postingId,
      cv_id:      cvId,
      error:      err instanceof Error ? err.message : String(err),
    });
  }

  // Fallback: no response_format constraint
  if (rawContent === null) {
    const retryContent = userContent + '\n\nIMPORTANT: Output ONLY valid JSON, no markdown code blocks, no extra text.';
    const response = await llm.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: retryContent   },
      ],
      temperature: TEMPERATURE,
      ...(IS_OLLAMA && { keep_alive: KEEP_ALIVE }),
    } as OllamaParams);
    const fallbackRaw = response.choices[0]?.message?.content ?? '{}';
    rawContent = fallbackRaw.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();
  }

  // Strip markdown code fences if present (e.g. ```json ... ```)
  const cleaned = rawContent
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  const parsed = JSON.parse(cleaned) as unknown;
  const output = validateOutput(parsed);

  logger.info('Match complete', { posting_id: postingId, cv_id: cvId, score: output.score });

  return {
    posting_id:      postingId,
    cv_id:           cvId,
    score:           output.score,
    summary:         output.summary,
    matched_skills:  output.matched,
    missing_skills:  output.missing,
    adjacent_skills: output.adjacent,
    model:           MODEL,
    matched_at:      new Date().toISOString(),
  };
}
