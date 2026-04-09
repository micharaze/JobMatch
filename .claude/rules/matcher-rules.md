# Matcher — Vector Similarity Retrieval

Relevant for: `services/matcher/`

Source of truth: `shared/config/matching.ts` — thresholds defined there, never hardcoded in service logic.

## Rule

The matcher retrieves the top-k most similar CV skills for each job skill using LanceDB vector
search. It acts as a fast pre-filter before the validator (Step 5). Only candidates that pass
the dimension-specific similarity threshold are forwarded.

## Why a Pre-Filter?

Comparing every job skill against every CV skill via LLM would require millions of calls for
any realistic dataset. The matcher reduces this to a manageable set of plausible candidates
cheaply and in milliseconds. The validator then makes the precise judgement.

## Asymmetric Query Encoding

At retrieval time, job skills are encoded as queries — NOT as documents:

```typescript
function encodeQuery(skill: string): string {
  return `query: ${skill}`;
}
```

CV skills were stored as `passage: {skill}` by the embedder. Using `query: ` here is
mandatory — see `embedding-rules.md` for the full asymmetric encoding contract.

## Dimension-Specific Similarity Thresholds

Vector similarity is semantically blind to dimension context. React and Angular are "close"
in the vector space (both JS frontend frameworks), but are NOT interchangeable in recruiting.
C and Go are similar vectors but distinct skills.

Each dimension has its own minimum cosine similarity threshold. Skills below the threshold
are dropped and never sent to the validator.

| Dimension               | Min. Cosine Similarity | Rationale                                       |
| ----------------------- | ---------------------- | ----------------------------------------------- |
| `programming_languages` | **0.92**               | Strict — C ≠ Go, Python ≠ Ruby                  |
| `tools`                 | **0.90**               | Strict — React ≠ Angular, MSBuild ≠ Gradle      |
| `infrastructure`        | **0.88**               | Strict-ish — AWS ≠ GCP, but Docker ≈ Podman ok  |
| `project_management`    | **0.85**               | Medium — Jira ≈ YouTrack, Scrum ≈ Kanban ok      |
| `domain_knowledge`      | **0.82**               | Medium — conceptual overlap is acceptable        |
| `spoken_languages`      | **0.95**               | Very strict — English ≠ German, always           |
| `soft_skills`           | **0.75**               | Loose — "Communication" ≈ "Collaboration" ok     |

All thresholds live in `shared/config/matching.ts` as a typed constant — import from there.

## Top-k Per Dimension

Return at most **5 candidates per job skill** to the validator. This keeps validator input
short and focused. Configurable via `MATCHER_TOP_K` env var (default: 5).

## Output Schema

The matcher returns a list of candidates per job skill, preserving dimension and priority
metadata so the validator and scorer can use them:

```typescript
interface MatchCandidate {
  job_skill:   string;
  cv_skill:    string;
  dimension:   string;
  priority:    'required' | 'preferred';
  score:       number;   // cosine similarity [0.0, 1.0]
  cv_point_id: string;   // Qdrant point ID of the CV skill
  posting_id:  string;   // which job posting this comes from
  cv_id:       string;   // which CV this candidate belongs to
}
```

Source of truth: `shared/schemas/matching.ts`

## LanceDB Filter

Always filter by `source_type = 'cv'` when searching for CV candidates. Job skills must
never match against other job skills.

```typescript
table
  .vectorSearch(queryVector)
  .where(`source_type = 'cv' AND dimension = '${dimension}'`)
  .distanceType('cosine')
  .limit(topK)
  .toArray();
```

Filtering by dimension in the query (not just in application code) keeps the search space
small and avoids cross-dimension false positives (e.g. "Python" tool vs "Python" language).

Vector data is stored in `data/vectors/` as files — no server process needed. LanceDB runs
fully embedded inside the service process, identical to how SQLite works for relational data.

## API Endpoints

Service port: **3004**

| Method | Path | Body / Query | Response |
| ------ | ---- | ------------ | -------- |
| `GET`  | `/health` | — | `{ status: 'ok' }` |
| `POST` | `/match` | `{ posting_id: string, cv_ids?: string[] }` | `{ ok, posting_id, cv_ids, message }` — responds immediately, processes in background |
| `GET`  | `/matches` | `?posting_id=&cv_id=&limit=&offset=` | `MatchCandidate[]` sorted by score desc |
| `GET`  | `/matches/:posting_id/:cv_id` | — | `{ posting_id, cv_id, count, candidates: MatchCandidate[] }` or 404 |
| `GET`  | `/status` | — | `{ pending, processing, done, error }` run counts |

### POST /match — notes
- If `cv_ids` is omitted, matches against **all** CVs with `embedding_status = 'done'`.
- Runs are idempotent: already-done pairs are skipped; errored pairs are retried.
- Results are stored in SQLite (`match_candidates` table) for the validator to consume.

### Match result persistence
- `match_runs` table — tracks `(posting_id, cv_id)` pair status: `pending | processing | done | error`
- `match_candidates` table — stores `MatchCandidate` rows (indexed on `posting_id, cv_id`)
