# Normalizer — Job Posting & CV Compression

Relevant for: `services/normalizer/`

Source of truth: `services/normalizer/src/llm/normalizer.ts` — the system prompts there are authoritative.

## Purpose

The normalizer converts verbose raw text (job posting descriptions, CV documents) into compact structured markdown profiles. This is done **once per document** and the result is cached in `normalized_text`. The matcher reads this cached text — it never sees raw descriptions.

**Why normalize instead of sending raw text to the matcher?**
- A raw job posting is 500–3000 tokens of noise (company marketing, benefits, EEO disclaimers).
- A raw CV is 1000–2000 tokens.
- Combined: 5000+ tokens leaves little room for a local model to reason about the actual match.
- Normalized: ~500 tokens combined, focused entirely on relevant requirements and skills.

## Output Formats

### Job Posting Profile

```
## Job: [Job Title] @ [Company Name]
**Level:** [inferred seniority and years required, e.g. "Senior (5+ yrs)"]
**Required:** [comma-separated required technical skills]
**Preferred:** [comma-separated preferred/nice-to-have skills]
**Domain:** [2-5 key technical domain areas]
**Project context:** [1-2 sentences: project type, team size, remote/onsite, contract length]
**Industry:** [industry if relevant — omit this line if not mentioned]
```

**Keep:** all technical requirements, project description, team context, work model, domain details.
**Remove:** company descriptions, mission statements, benefits, perks, salary, EEO disclaimers, application instructions.

### CV Profile

```
## CV: [First name + last initial only] — [current or most recent role]
**Level:** [inferred seniority, e.g. "Senior (8+ yrs)"]
**Active ([most recent 2-3 yr range]):** [skills actively used in recent positions]
**Solid ([middle range]):** [skills used regularly but not in the most recent years]
**Past ([older range or "pre-YEAR"]):** [skills from older positions or barely mentioned]
**Workflow:** [PM tools, version control, CI/CD]
**Domain:** [2-4 specialisation areas]
```

**Active / Solid / Past** are inferred from work history date ranges. If no dates are present in the CV, fall back to: `**Primary:**`, `**Secondary:**`, `**Mentioned briefly:**`.

The temporal grouping is critical — the matcher needs to know whether a skill is current or historical. A candidate with PHP from 7 years ago is not a PHP developer.

## DB Columns

Written to by this service (via `ALTER TABLE ... ADD COLUMN` try/catch in `sqlite.ts` constructor):

- `job_postings.normalized_text TEXT`
- `job_postings.normalization_status TEXT` — `pending | processing | done | error`
- `cvs.normalized_text TEXT`
- `cvs.normalization_status TEXT` — `pending | processing | done | error`

Status lifecycle: `pending → processing → done | error`. Rows stuck in `processing` on startup are reset to `pending` via `recoverStale()`.

## LLM Call

- Plain text output — do NOT use `response_format: json_object` or tool calling.
- `max_tokens: 500` — enforces compactness.
- Validate output: must be `> 80 chars` and contain `##`. Throw if not — the caller marks `error` and the row will be retried.
- Temperature: `0.1` — deterministic, consistent output.

## API Endpoints

Service port: **3002**

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET`  | `/health` | — | `{ status: 'ok' }` |
| `POST` | `/normalize` | `{ posting_id }` | `{ ok, posting_id, normalized_text }` — synchronous |
| `POST` | `/normalize-cv` | `{ cv_id }` | `{ ok, cv_id, normalized_text }` — synchronous |
| `POST` | `/process-pending` | `{ limit? }` | `{ claimed, message }` — responds immediately, background |

### Notes

- `/normalize` returns 409 if the posting is already `processing` or `done`.
- `/normalize-cv` returns 409 if the CV is already `processing` or `done`.
- `/process-pending` only processes job postings (CVs are normalized on-demand via `/normalize-cv`).
- The CV service calls `/normalize-cv` automatically after upload — callers don't need to trigger it manually.
