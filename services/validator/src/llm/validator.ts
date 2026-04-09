import type { ChatCompletionTool, ChatCompletionMessageParam } from 'openai/resources';
import type { MatchCandidate, ValidatedMatch } from '@jobcheck/shared';
import { llm, MODEL, KEEP_ALIVE, type OllamaParams } from './client';
import logger from '../logger';

const TEMPERATURE = Number(process.env.VALIDATION_TEMPERATURE ?? 0.1);

// ── Tool definition ───────────────────────────────────────────────────────────

const LABEL_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'label_matches',
    description:
      'Assign an exact/semantic/uncertain label to each skill match candidate. ' +
      'Call this function exactly once with all candidates.',
    parameters: {
      type: 'object',
      properties: {
        matches: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              job_skill:  { type: 'string', description: 'The job posting skill.' },
              cv_skill:   { type: 'string', description: 'The CV skill.' },
              match_type: {
                type: 'string',
                enum: ['exact', 'semantic', 'uncertain'],
                description:
                  'exact = same skill (possibly different wording). ' +
                  'semantic = related but not identical. ' +
                  'uncertain = weak or unclear relationship.',
              },
              confidence: {
                type: 'number',
                description: 'Confidence in the label [0.0–1.0].',
              },
              reasoning: {
                type: 'string',
                description: 'One sentence explaining the label.',
              },
            },
            required: ['job_skill', 'cv_skill', 'match_type', 'confidence', 'reasoning'],
            additionalProperties: false,
          },
        },
      },
      required: ['matches'],
      additionalProperties: false,
    },
  },
};

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a recruiting skill-match validator.
You receive a list of (job_skill, cv_skill) pairs from one skill dimension and must label each one.

Labels:
- exact: The same skill, possibly with slightly different wording. E.g. "Python 3" vs "Python".
- semantic: Related but not identical — the CV skill partially satisfies the job requirement. E.g. "data analysis" vs "statistical modeling".
- uncertain: Weak or unclear relationship — do not count this as a match.

Dimension-specific strictness:
- programming_languages: Only exact if truly the same language. C ≠ Go = uncertain.
- tools: Only exact if same tool/framework. React ≠ Angular = uncertain. Jest ≈ Vitest = semantic.
- infrastructure: Docker ≈ Podman = semantic. AWS ≠ GCP = uncertain unless clearly cloud-agnostic.
- project_management: Scrum ≈ Kanban = semantic. Jira ≈ YouTrack = semantic. Agile ≠ Waterfall = uncertain.
- domain_knowledge: Conceptual overlap is acceptable for semantic. "CI/CD" ≈ "Build Pipelines" = semantic.
- spoken_languages: Only exact if the same language. English ≠ German = uncertain. Always.
- soft_skills: Most lenient. "Communication" ≈ "Collaboration" = semantic or exact is fine.

Never label a pair as exact or semantic based on superficial similarity alone.
The CV skill must genuinely satisfy the job requirement in a real recruiting context.

Use the label_matches function. Do not respond with plain text.`;

// ── Helpers ───────────────────────────────────────────────────────────────────

interface RawMatch {
  job_skill:  string;
  cv_skill:   string;
  match_type: string;
  confidence: number;
  reasoning:  string;
}

function isValidMatchType(v: unknown): v is 'exact' | 'semantic' | 'uncertain' {
  return v === 'exact' || v === 'semantic' || v === 'uncertain';
}

function parseRawMatches(raw: unknown): RawMatch[] {
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !Array.isArray((raw as Record<string, unknown>)['matches'])
  ) {
    return [];
  }
  return (raw as { matches: unknown[] }).matches.filter(
    (m): m is RawMatch =>
      typeof m === 'object' &&
      m !== null &&
      typeof (m as Record<string, unknown>)['job_skill']  === 'string' &&
      typeof (m as Record<string, unknown>)['cv_skill']   === 'string' &&
      typeof (m as Record<string, unknown>)['reasoning']  === 'string' &&
      isValidMatchType((m as Record<string, unknown>)['match_type']),
  );
}

// ── Core validation logic ─────────────────────────────────────────────────────

/**
 * Validate a batch of MatchCandidates for a single dimension using the LLM.
 * Returns ValidatedMatch[] with posting_id and cv_id carried through.
 */
async function validateDimension(
  dimension:  string,
  candidates: MatchCandidate[],
): Promise<Array<Omit<ValidatedMatch, 'posting_id' | 'cv_id'>>> {
  // Map job_skill → priority so we can carry it through after LLM output
  const priorityMap = new Map(candidates.map((c) => [c.job_skill, c.priority]));
  const candidateList = candidates
    .map((c) => `- job_skill: "${c.job_skill}", cv_skill: "${c.cv_skill}"`)
    .join('\n');

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Dimension: ${dimension}\n\nCandidates:\n${candidateList}`,
    },
  ];

  // ── Primary path: function calling ───────────────────────────────────────
  let rawArgs: string | null = null;

  try {
    const response = await llm.chat.completions.create({
      model:       MODEL,
      messages,
      tools:       [LABEL_TOOL],
      tool_choice: { type: 'function', function: { name: 'label_matches' } },
      temperature: TEMPERATURE,
      keep_alive:  KEEP_ALIVE,
    } as OllamaParams);

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.name === 'label_matches') {
      rawArgs = toolCall.function.arguments;
    }
  } catch (err) {
    logger.warn('Tool calling failed, attempting JSON fallback', {
      dimension,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Fallback path: JSON object ────────────────────────────────────────────
  if (rawArgs === null) {
    const fallbackMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `Dimension: ${dimension}\n\nCandidates:\n${candidateList}\n\n` +
          'Return ONLY a JSON object: { "matches": [ { "job_skill", "cv_skill", "match_type", "confidence", "reasoning" } ] }',
      },
    ];

    const fallback = await llm.chat.completions.create({
      model:           MODEL,
      messages:        fallbackMessages,
      response_format: { type: 'json_object' },
      temperature:     TEMPERATURE,
      keep_alive:      KEEP_ALIVE,
    } as OllamaParams);

    rawArgs = fallback.choices[0]?.message?.content ?? '{}';
    logger.info('Used JSON fallback for validation', { dimension });
  }

  // ── Parse ─────────────────────────────────────────────────────────────────
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArgs);
  } catch {
    logger.warn('LLM returned invalid JSON for dimension', { dimension, rawArgs: rawArgs.slice(0, 200) });
    return [];
  }

  return parseRawMatches(parsed).map((m) => ({
    job_skill:  m.job_skill,
    cv_skill:   m.cv_skill,
    dimension,
    priority:   priorityMap.get(m.job_skill) ?? 'required',
    match_type: m.match_type as 'exact' | 'semantic' | 'uncertain',
    confidence: Math.max(0, Math.min(1, Number(m.confidence) || 0)),
    reasoning:  m.reasoning,
  }));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Validate all match candidates for a (posting_id, cv_id) pair.
 * Groups candidates by dimension and calls the LLM once per group.
 */
export async function validateCandidates(
  postingId:  string,
  cvId:       string,
  candidates: MatchCandidate[],
): Promise<ValidatedMatch[]> {
  // Group by dimension
  const byDimension = new Map<string, MatchCandidate[]>();
  for (const c of candidates) {
    const group = byDimension.get(c.dimension) ?? [];
    group.push(c);
    byDimension.set(c.dimension, group);
  }

  const results: ValidatedMatch[] = [];

  for (const [dimension, group] of byDimension) {
    try {
      const validated = await validateDimension(dimension, group);
      for (const v of validated) {
        results.push({ posting_id: postingId, cv_id: cvId, ...v });
      }
    } catch (err) {
      logger.warn('Dimension validation failed', {
        dimension,
        posting_id: postingId,
        cv_id:      cvId,
        error:      err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('Validation complete', {
    posting_id: postingId,
    cv_id:      cvId,
    validated:  results.length,
  });

  return results;
}
