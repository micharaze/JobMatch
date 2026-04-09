import type { ChatCompletionTool, ChatCompletionMessageParam, ChatCompletionCreateParamsNonStreaming } from 'openai/resources';

// Ollama-specific extension: keep_alive controls how long the model stays in VRAM after the request.
type OllamaParams = ChatCompletionCreateParamsNonStreaming & { keep_alive?: string };
import { llm, MODEL } from './client';

const TEMPERATURE  = Number(process.env.EXTRACTION_TEMPERATURE ?? 0.1);
const KEEP_ALIVE   = process.env.OLLAMA_KEEP_ALIVE ?? '5m';
import { ExtractionResultSchema, type ExtractionResult, type SkillSet } from '@jobcheck/shared';
import logger from '../logger';

// ── Title-case normalization ──────────────────────────────────────────────────

function toTitleCase(skill: string): string {
  return skill
    .trim()
    .split(/\s+/)
    .map((word) =>
      // Preserve all-caps acronyms (SQL, REST, API, AWS, CI/CD, etc.)
      word.length >= 2 && word === word.toUpperCase()
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join(' ');
}

function normalizeSkillArray(skills: unknown): string[] {
  if (!Array.isArray(skills)) return [];
  return (skills as unknown[])
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map(toTitleCase);
}

function normalizeSkillSet(raw: unknown): SkillSet {
  if (typeof raw !== 'object' || raw === null) {
    return { required: [], preferred: [] };
  }
  const obj = raw as Record<string, unknown>;
  return {
    required:  normalizeSkillArray(obj['required']),
    preferred: normalizeSkillArray(obj['preferred']),
  };
}

// ── Shared skill-set parameter definition ────────────────────────────────────

function skillSetParam(description: string): object {
  return {
    type: 'object',
    description,
    properties: {
      required:  { type: 'array', items: { type: 'string' }, description: 'Must-have skills explicitly required for this role.' },
      preferred: { type: 'array', items: { type: 'string' }, description: 'Nice-to-have skills mentioned as optional, helpful, or preferred.' },
    },
    required: ['required', 'preferred'],
    additionalProperties: false,
  };
}

// ── Tool definition ───────────────────────────────────────────────────────────

const EXTRACT_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'extract_skills',
    description: 'Extract structured skills from a job posting or CV. Call this function exactly once.',
    parameters: {
      type: 'object',
      properties: {
        source_type: {
          type: 'string',
          enum: ['job_posting', 'cv'],
          description: 'Whether the input is a job posting or a CV.',
        },
        domain_knowledge: skillSetParam(
          'Technical knowledge areas without a specific tool: "Build Pipelines", "CI/CD", "Compilation", "Machine Learning", "REST API Design", "Dependency Management".',
        ),
        programming_languages: skillSetParam(
          'Programming and scripting languages only: "C++", "Python", "TypeScript", "SQL", "PowerShell", "Bash". NOT frameworks or libraries.',
        ),
        tools: skillSetParam(
          'Development tools, IDEs, frameworks, and libraries: "React", "Vue", "Angular", "MSBuild", "Visual Studio", "PyTorch", "Jest", "SCons", "Conan". NOT cloud or CI/CD platforms.',
        ),
        infrastructure: skillSetParam(
          'Cloud providers, CI/CD systems, container and orchestration platforms: "AWS", "Azure", "GCP", "Jenkins", "GitHub Actions", "Azure DevOps", "Docker", "Kubernetes", "Terraform", "Helm".',
        ),
        project_management: skillSetParam(
          'Project management tools and methodologies: "Jira", "Confluence", "Scrum", "Kanban", "Agile", "SAFe".',
        ),
        spoken_languages: skillSetParam(
          'Human spoken/written languages only: "English", "German", "French". NOT programming languages.',
        ),
        soft_skills: skillSetParam(
          'Interpersonal and organizational skills: "Communication", "Team Leadership", "Mentoring". NOT methodologies like Agile.',
        ),
        experience_level: {
          type: ['string', 'null'],
          enum: ['junior', 'mid', 'senior', 'lead', null],
          description: 'Experience level required or demonstrated. Infer from context ("5+ years" → senior, "entry-level" → junior). null if not determinable.',
        },
      },
      required: [
        'source_type',
        'domain_knowledge',
        'programming_languages',
        'tools',
        'infrastructure',
        'project_management',
        'spoken_languages',
        'soft_skills',
        'experience_level',
      ],
      additionalProperties: false,
    },
  },
};

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a structured skill extraction assistant for a recruiting system.
Given a job posting or CV, extract all skills into the provided function schema.

Category rules:
- domain_knowledge: Technical knowledge areas (concepts, methodologies). E.g. "Build Pipelines", "CI/CD", "Compilation", "Machine Learning".
- programming_languages: Languages you write code in. E.g. "C++", "Python", "TypeScript", "PowerShell". NOT React or NumPy.
- tools: Dev tools, IDEs, frameworks, libraries. E.g. "React", "MSBuild", "Visual Studio", "PyTorch", "SCons".
- infrastructure: Cloud providers, CI/CD systems, containers. E.g. "AWS", "Azure", "Jenkins", "Docker", "Kubernetes".
- project_management: PM tools and methodologies. E.g. "Jira", "Scrum", "Kanban", "Agile".
- spoken_languages: Human languages only. E.g. "English", "German". NOT programming languages.
- soft_skills: Interpersonal skills. E.g. "Communication", "Team Leadership". NOT Agile or Scrum.

Required vs preferred — infer from section context first, then from language strength:

Section context (highest priority):
- Section header "Must have", "Requirements", "Hauptqualifikationen", "Main qualifications" → all skills in that section are required.
- Section header "Nice to have", "Preferred", "Von Vorteil", "Additional", "Wünschenswert" → all skills in that section are preferred.

Language strength (when no section header applies):
- required: strong language — "solid experience", "deep knowledge", "proficient in", "expertise in", just listed without qualifier (default).
- preferred: weak language — "would be helpful", "is a plus", "knowledge of X is an advantage", "ideally", "von Vorteil", "wünschenswert", "Erfahrung von Vorteil", "Kenntnisse wünschenswert".

Default when ambiguous: classify as required. It is better to over-classify as required than to miss a skill entirely.

For CVs: required = clearly demonstrated with context or years of experience; preferred = mentioned briefly or without evidence of depth.

General rules:
- Use the extract_skills function. Do not respond with plain text.
- Extract ALL skills mentioned in the text — do not skip skills because they seem minor.
- Empty arrays are valid — never omit a field.
- Do not duplicate items across categories.
- experience_level: infer from context. Use null if genuinely unclear.`;

// ── Main extraction function ──────────────────────────────────────────────────

export async function extractSkills(
  description: string,
  sourceType: 'job_posting' | 'cv' = 'job_posting',
): Promise<ExtractionResult> {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Extract skills from the following ${sourceType}:\n\n${description}`,
    },
  ];

  // ── Primary path: tool / function calling ─────────────────────────────────
  let rawArgs: string | null = null;

  try {
    const response = await llm.chat.completions.create({
      model: MODEL,
      messages,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'function', function: { name: 'extract_skills' } },
      temperature: TEMPERATURE,
      keep_alive: KEEP_ALIVE,
    } as OllamaParams);

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.name === 'extract_skills') {
      rawArgs = toolCall.function.arguments;
    }
  } catch (err) {
    logger.warn('Tool calling path failed, attempting JSON fallback', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Fallback path: response_format json_object ────────────────────────────
  if (rawArgs === null) {
    const emptySkillSet = '{"required":[],"preferred":[]}';
    const fallbackMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Extract skills from the following ${sourceType} and return ONLY a JSON object with this exact shape:
{
  "source_type": "${sourceType}",
  "domain_knowledge":      ${emptySkillSet},
  "programming_languages": ${emptySkillSet},
  "tools":                 ${emptySkillSet},
  "infrastructure":        ${emptySkillSet},
  "project_management":    ${emptySkillSet},
  "spoken_languages":      ${emptySkillSet},
  "soft_skills":           ${emptySkillSet},
  "experience_level": null
}

${description}`,
      },
    ];

    const fallbackResponse = await llm.chat.completions.create({
      model: MODEL,
      messages: fallbackMessages,
      response_format: { type: 'json_object' },
      temperature: TEMPERATURE,
      keep_alive: KEEP_ALIVE,
    } as OllamaParams);

    rawArgs = fallbackResponse.choices[0]?.message?.content ?? '{}';
    logger.info('Used JSON fallback path for extraction');
  }

  // ── Parse and validate ────────────────────────────────────────────────────
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArgs);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${rawArgs.slice(0, 200)}`);
  }

  // Inject source_type if missing
  if (typeof parsed === 'object' && parsed !== null && !('source_type' in parsed)) {
    (parsed as Record<string, unknown>)['source_type'] = sourceType;
  }

  const validated = ExtractionResultSchema.parse(parsed);

  // ── Normalize all skill sets to title case ────────────────────────────────
  return {
    source_type:           validated.source_type,
    domain_knowledge:      normalizeSkillSet(validated.domain_knowledge),
    programming_languages: normalizeSkillSet(validated.programming_languages),
    tools:                 normalizeSkillSet(validated.tools),
    infrastructure:        normalizeSkillSet(validated.infrastructure),
    project_management:    normalizeSkillSet(validated.project_management),
    spoken_languages:      normalizeSkillSet(validated.spoken_languages),
    soft_skills:           normalizeSkillSet(validated.soft_skills),
    experience_level:      validated.experience_level,
  };
}
