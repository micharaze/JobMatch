# Scoring — Deterministic Weighted Scoring

Relevant for: `services/scorer/`

Source of truth: `shared/schemas/scoring.ts` — this rule documents the contract, but the Zod schema in `shared/` is authoritative.

## Rule

Scoring is fully deterministic — no LLM involved.
All weights are defined here. Never hardcode them in service logic.

## Weights

Skill dimensions sum to 0.90; `experience_level` has a fixed weight of 0.10.

| Dimension | Weight |
|-----------|--------|
| `domain_knowledge` | 0.28 |
| `programming_languages` | 0.22 |
| `infrastructure` | 0.15 |
| `tools` | 0.10 |
| `project_management` | 0.08 |
| `soft_skills` | 0.05 |
| `spoken_languages` | 0.02 |
| `experience_level` | 0.10 |
| **Total** | **1.00** |

## Experience Level Scoring

`experience_level` comes from the extractor (step 2) for both job postings and CVs.
This dimension uses a compatibility matrix instead of skill matching:

| CV \ Job   | junior | mid | senior | lead |
| ---------- | ------ | --- | ------ | ---- |
| **junior** | 1.0    | 0.3 | 0.0    | 0.0  |
| **mid**    | 1.0    | 1.0 | 0.4    | 0.2  |
| **senior** | 0.8    | 1.0 | 1.0    | 0.6  |
| **lead**   | 0.5    | 0.8 | 1.0    | 1.0  |

If either side is `null`, score `experience_level` as 0.5 (neutral — neither penalty nor bonus).

## Match Type Multipliers

Apply these multipliers to each matched skill before weighting:

| match_type  | Multiplier     |
| ----------- | -------------- |
| `exact`     | 1.0            |
| `semantic`  | 0.6            |
| `uncertain` | 0.0 (excluded) |

## Required vs Preferred Weighting

Each skill dimension contains `required` and `preferred` arrays (from the extractor).
Required skills count fully; preferred skills count at half weight:

```
dimension_score =
  (matched_required + 0.5 × matched_preferred)
  / max(total_required + 0.5 × total_preferred, 1)
```

Where `matched_required` and `matched_preferred` are the sums of match_type multipliers
for matched skills in each bucket.

## Full Score Calculation

```
dimension_score[d] =
  (Σ multiplier(match) for required matches  +  0.5 × Σ multiplier(match) for preferred matches)
  / max(count(required[d]) + 0.5 × count(preferred[d]), 1)

experience_score = compatibility_matrix[cv_level][job_level]

final_score = Σ(dimension_score[d] × weight[d]  for d in skill_dimensions)
            + experience_score × 0.10
```

Final score is in range [0.0, 1.0].

## API Endpoints

Service port: **3006**

| Method | Path | Body / Query | Response |
| ------ | ---- | ------------ | -------- |
| `GET`  | `/health` | — | `{ status: 'ok' }` |
| `POST` | `/score` | `{ posting_id: string, cv_ids?: string[] }` | `{ ok, posting_id, cv_ids, message }` — responds immediately, processes in background |
| `POST` | `/process-pending` | — | `{ scored: number, message }` — scores all validated pairs not yet scored |
| `GET`  | `/scores` | `?posting_id=&cv_id=&limit=&offset=` | `ScoringResult[]` sorted by final_score desc |
| `GET`  | `/scores/:posting_id` | — | `{ posting_id, count, scores: ScoringResult[] }` ranked by score, or 404 |
| `GET`  | `/scores/:posting_id/:cv_id` | — | `ScoringResult` or 404 |

### Scoring is synchronous and CPU-only
No LLM involved. Each pair is scored in microseconds. Background processing is used only to match the HTTP response pattern of other services.

### Data sources (all read from shared SQLite DB)
- `validated_matches` — match results with `priority` and `match_type`
- `extracted_skills` — job posting skill counts (denominator) and experience levels for both sides

### Result persistence
- `scores` table — one row per `(posting_id, cv_id)`, upserted on re-score. `dimension_scores` stored as JSON.
