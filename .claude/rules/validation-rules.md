# Validator — Skill Match Labelling

Relevant for: `services/validator/`

Source of truth: `shared/schemas/validation.ts` — this rule documents the contract, but the Zod schema in `shared/` is authoritative.

## Rule

The validator receives the top-k candidates from the matcher and assigns a label to each
one. Output must be structured JSON via function calling or constrained output — never parse
free-text labels. The output must be machine-readable for the scorer.

The current model is **Gemma 4 E4B** via Ollama, but the interface is model-agnostic.
Swapping the model only requires changing the LLM client config — the input/output schema
and labelling rules stay the same.

## Output Schema

```json
{
  "matches": [
    {
      "job_skill":  "string — the job posting skill being validated",
      "cv_skill":   "string — the matched CV skill from vector retrieval",
      "dimension":  "string — skill category (e.g. programming_languages)",
      "match_type": "exact | semantic | uncertain",
      "confidence": 0.0,
      "reasoning":  "string — short explanation of the label"
    }
  ]
}
```

- `confidence`: float in range `[0.0, 1.0]`

## Label Definitions

| Label       | Meaning                                                                    |
| ----------- | -------------------------------------------------------------------------- |
| `exact`     | Same skill, possibly different wording (e.g. "Python 3" vs "Python")       |
| `semantic`  | Related but not identical (e.g. "data analysis" vs "statistical modeling") |
| `uncertain` | Weak or unclear relationship — do not count as a match in scoring          |

## Input Structure

The model receives only the top-k vector retrieval candidates — not the full job posting.
Keep the input short and always include `dimension` so the model can apply the correct
strictness for that category.

```json
{
  "dimension": "programming_languages",
  "job_skill": "React",
  "cv_skill":  "Angular"
}
```

## Dimension-Aware Labelling Rules

The model must apply different strictness depending on the dimension. These rules must be
included in the system prompt or function description:

| Dimension               | Guidance                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `programming_languages` | Only `exact` if truly the same language (Python 3 = Python). C ≠ Go = `uncertain`.           |
| `tools`                 | Only `exact` if same tool/framework. React ≠ Angular = `uncertain`. Jest ≈ Vitest = `semantic`. |
| `infrastructure`        | Docker ≈ Podman = `semantic`. AWS ≠ GCP = `uncertain` unless role is cloud-agnostic.         |
| `project_management`    | Scrum ≈ Kanban = `semantic`. Jira ≈ YouTrack = `semantic`. Agile ≠ Waterfall = `uncertain`.  |
| `domain_knowledge`      | Conceptual overlap is acceptable for `semantic` (e.g. "CI/CD" ≈ "Build Pipelines").          |
| `spoken_languages`      | Only `exact` if same language. English ≠ German = `uncertain`. Always.                       |
| `soft_skills`           | Most lenient. "Communication" ≈ "Collaboration" = `semantic` or `exact` is fine.             |

**Never** label a skill as `exact` or `semantic` based on superficial similarity alone —
the candidate must genuinely satisfy the job requirement in a real recruiting context.

## API Endpoints

Service port: **3005**

| Method | Path | Body / Query | Response |
| ------ | ---- | ------------ | -------- |
| `GET`  | `/health` | — | `{ status: 'ok' }` |
| `POST` | `/validate` | `{ posting_id: string, cv_ids?: string[] }` | `{ ok, posting_id, cv_ids, message }` — responds immediately, processes in background |
| `POST` | `/process-pending` | — | `{ claimed: number, message }` — validates all completed match pairs not yet validated |
| `GET`  | `/validations` | `?posting_id=&cv_id=&limit=&offset=` | `ValidatedMatch[]` sorted by confidence desc |
| `GET`  | `/validations/:posting_id/:cv_id` | — | `{ posting_id, cv_id, count, matches: ValidatedMatch[] }` or 404 |
| `GET`  | `/status` | — | `{ pending, processing, done, error }` run counts |

### POST /validate — notes
- If `cv_ids` is omitted, discovers target CVs from completed match runs for the given posting.
- Already-done pairs are skipped; errored pairs are retried.
- Reads `match_candidates` from the matcher's table; writes results to `validated_matches`.

### POST /process-pending — notes
- Finds all `match_runs` with `status = 'done'` that have no corresponding `validation_run`.
- Processes sequentially (LLM calls are not parallelised to avoid VRAM contention).

### Result persistence
- `validation_runs` table — tracks `(posting_id, cv_id)` pair status: `pending | processing | done | error`
- `validated_matches` table — stores `ValidatedMatch` rows (indexed on `posting_id, cv_id`)
