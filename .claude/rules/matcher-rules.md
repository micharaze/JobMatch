# Matcher — LLM-Based CV-to-Job Scoring

Relevant for: `services/matcher/`

Source of truth: `services/matcher/src/llm/matcher.ts` — the system prompt and scoring rules there are authoritative.

## Purpose

The matcher performs a single LLM call per (job posting, CV) pair and produces a structured score with reasoning. It replaces the old 3-service chain (matcher → validator → scorer) with one direct LLM judgement.

**Why LLM instead of embeddings?**
- Embeddings are semantically blind to domain context: React and Angular are "close" vectors, but NOT interchangeable in recruiting. C and Go are similar vectors but distinct skills.
- LLMs understand skill relationships natively — no threshold calibration required.
- For a single-CV use case, the scale advantage of vector search doesn't apply.

## Input

Reads `normalized_text` directly from `job_postings` and `cvs` tables (only pairs where both `normalization_status = 'done'`). Never reads raw descriptions — the normalizer caches the compact profiles once per document.

## Output Schema

```typescript
interface MatchResult {
  posting_id:      string;
  cv_id:           string;
  score:           number;    // 0–100 integer
  summary:         string;    // 2–3 sentence assessment
  matched_skills:  string[];
  missing_skills:  string[];
  adjacent_skills: string[];  // e.g. "Vue.js → Angular: related but different framework"
  model:           string;
  matched_at:      string;
}
```

Source of truth: `shared/schemas/match-result.ts`

## Scoring Rules

These rules are enforced via the system prompt — see `services/matcher/src/llm/matcher.ts` for the authoritative text.

- **Score 70+** only if the candidate meets most required skills AND those skills are **current/active**.
- Skills in the CV's **"Past"** bucket (older positions) count at **half weight** — treat as background knowledge, not active proficiency.
- **Strict skill identity**: React ≠ Angular, Vue.js ≠ Angular, Python ≠ Java. These are never matched.
- **Adjacent ≠ matched**: A skill that is related but not the same goes in `adjacent_skills`, not `matched_skills`. Example: `"Vue.js → Angular: similar component model, not directly transferable"`.
- **Domain context bonus**: Up to 10 points if the CV shows deep experience matching the job's project context (e.g. same industry, same project type, same team scale).
- **Score bands**:
  - 0–40: significant skill gaps
  - 41–65: partial match
  - 66–80: solid match
  - 81–100: strong match

## LLM Call

- `response_format: { type: 'json_object' }` — primary attempt.
- Fallback: retry once without `response_format`, with an explicit JSON instruction appended to the prompt.
- Strip markdown code fences (` ```json ... ``` `) before `JSON.parse`.
- Temperature: `0.1` — deterministic output.
- Validate output: `score` must be 0–100 integer, `summary` non-empty, all skill arrays present. Throw if invalid — the caller marks `error` and the pair will be retried by `process-pending`.

## DB Schema

```sql
CREATE TABLE IF NOT EXISTS match_results (
  id              INTEGER PRIMARY KEY,
  posting_id      TEXT NOT NULL,
  cv_id           TEXT NOT NULL,
  score           INTEGER NOT NULL,
  summary         TEXT NOT NULL,
  matched_skills  TEXT NOT NULL DEFAULT '[]',
  missing_skills  TEXT NOT NULL DEFAULT '[]',
  adjacent_skills TEXT NOT NULL DEFAULT '[]',
  model           TEXT NOT NULL,
  matched_at      TEXT NOT NULL,
  UNIQUE(posting_id, cv_id)
);
CREATE INDEX IF NOT EXISTS idx_match_results_posting ON match_results(posting_id, score DESC);
```

`matched_skills`, `missing_skills`, and `adjacent_skills` are stored as JSON arrays.

## Pending Pair Discovery

`process-pending` finds all normalized pairs that have no match result yet:

```sql
SELECT jp.id AS posting_id, c.id AS cv_id
FROM job_postings jp
CROSS JOIN cvs c
LEFT JOIN match_results mr ON mr.posting_id = jp.id AND mr.cv_id = c.id
WHERE jp.normalization_status = 'done'
  AND c.normalization_status  = 'done'
  AND mr.id IS NULL
```

## API Endpoints

Service port: **3004**

| Method | Path | Body / Query | Response |
|--------|------|--------------|----------|
| `GET`  | `/health` | — | `{ status: 'ok' }` |
| `POST` | `/match` | `{ posting_id, cv_id? }` | `{ ok, posting_id, cv_id, message }` — responds immediately, processes in background |
| `POST` | `/process-pending` | `{ limit? }` | `{ started, message }` — matches all unmatched normalized pairs; background |
| `GET`  | `/matches` | `?posting_id=&cv_id=&limit=&offset=` | `MatchResult[]` sorted by score DESC |
| `GET`  | `/matches/:posting_id` | — | `MatchResult[]` for all CVs matched against this posting, ranked |
| `GET`  | `/matches/:posting_id/:cv_id` | — | `MatchResult` or 404 |

### Notes

- `POST /match` without `cv_id` matches the posting against **all** normalized CVs.
- Results are upserted (`INSERT OR REPLACE`) — re-running a match overwrites the previous result.
- `POST /process-pending` is the normal trigger after normalizing a batch of postings.
