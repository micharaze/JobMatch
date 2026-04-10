# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Status: Backend services implemented** — `scraper`, `normalizer`, `matcher`, and `cv` are running. The `ui/` service (React frontend) is not yet implemented.

## Project: JobMatch — Recruiting Matcher

A pipeline-based recruiting system that matches job postings to a CV using LLM-based normalization and scoring. Each pipeline stage is an independent **Node.js + TypeScript** service.

### Pipeline Architecture

```
Job Postings (scraped)              CV (POST /cvs — file upload)
       │                                    │
       ▼                                    ▼
[1] Scraper Service                  CV Service (port 3007)
       │  fetches & stores                  │  parses PDF/DOCX/TXT
       │  job postings                      │  stores raw text in cvs table
       │                                    │  calls POST /normalize-cv
       ▼                                    ▼
[2] Normalizer Service  ←─────────────────────
       │  Compresses verbose job posting descriptions and CV text
       │  into compact structured markdown profiles (~250 tokens).
       │  Strips boilerplate; preserves requirements + project context.
       │  For CVs: groups skills by recency (Active / Solid / Past).
       │  Writes normalized_text + normalization_status to job_postings / cvs tables.
       │  Runs once per document and caches the result.
       ▼
[3] Matcher Service  (port 3004)
       │  Single LLM call per (posting, CV) pair.
       │  Reads normalized_text from both tables.
       │  Produces: score 0–100, summary, matched/missing/adjacent skills.
       │  Stores results in match_results table.
       ▼
[4] UI / API Service  (not yet implemented)
       React + TypeScript frontend;
       displays ranked job postings with scores and reasoning.
```

**Important design decisions:**

- **No vector embeddings.** The old embedding-based pipeline (embedder, LanceDB, vector similarity, validator, scorer) has been removed. LLMs understand skill relationships better than cosine similarity — React ≠ Angular, but C ≈ C++ — without any threshold calibration.
- **Normalize once, match many.** Normalization is expensive (LLM call) but happens once per document. Matching re-reads the cached `normalized_text`. Adding a new CV or posting only requires normalizing that one document.
- **Temporal skill context.** CV normalization groups skills into Active / Solid / Past buckets using work history dates. The matcher uses this to weight recent skills higher than historical ones.

### LLM Usage

Both normalizer and matcher use the same model. Supported backends:

| Provider | Config | Notes |
|----------|--------|-------|
| Ollama (local) | `LLM_PROVIDER=ollama`, `GEMMA_BASE_URL`, `GEMMA_MODEL` | Default. Private, no API cost. |
| Gemini API | `LLM_PROVIDER=gemini`, `GEMINI_API_KEY`, `GEMINI_MODEL` | Cloud. Better quality at small cost. |

Model is set independently per service via `NORMALIZER_MODEL` and `MATCHER_MODEL` env vars (fall back to `GEMMA_MODEL` / `GEMINI_MODEL`).

See `.claude/rules/` for specific rules — load only what is relevant to the current service:

| Rule file              | When to load              |
| ---------------------- | ------------------------- |
| `scraper-rules.md`     | Working in `scraper/`     |
| `normalizer-rules.md`  | Working in `normalizer/`  |
| `matcher-rules.md`     | Working in `matcher/`     |

## Commands

```bash
# Install all dependencies (from repo root)
npm install

# Start all services (Docker)
docker compose up

# Run a single service in development
cd services/<service-name>
npm run dev

# TypeScript compile check (no emit)
cd services/<service-name>
npx tsc --noEmit

# Run tests for a service
cd services/<service-name>
npm test

# Run all tests from root
npm test
```

## Service Layout

```
services/
  scraper/      # Job posting fetcher (port 3001)
  normalizer/   # LLM normalization of job postings and CVs (port 3002)
  matcher/      # LLM-based CV-to-job scoring (port 3004)
  cv/           # CV file upload, text parsing, normalization trigger (port 3007)
  ui/           # React + TypeScript frontend — NOT YET IMPLEMENTED
shared/         # TypeScript types, Zod schemas, LLM client pattern, skill aliases
```

## Database

Single SQLite file at `data/scraper.db`, shared across all services via Docker volume `./data:/app/data`.

All services open with `PRAGMA journal_mode = WAL` to allow concurrent reads.

**Key tables:**

| Table | Written by | Read by |
|-------|-----------|---------|
| `job_postings` | scraper | normalizer, matcher |
| `cvs` | cv service | normalizer, matcher |
| `match_results` | matcher | ui (future) |

**Columns added by normalizer** (via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`):
- `job_postings.normalized_text TEXT`
- `job_postings.normalization_status TEXT` — `pending | processing | done | error`
- `cvs.normalized_text TEXT`
- `cvs.normalization_status TEXT` — `pending | processing | done | error`

**No separate `cv_id` column anywhere.** CVs are identified by their `id` in the `cvs` table (format: `cv:<uuid>`). `match_results` uses `posting_id` and `cv_id` as a composite key.

## Shared Package

`shared/` exports:
- `shared/schemas/job-posting.ts` — `JobPosting` type
- `shared/schemas/match-result.ts` — `MatchResult` interface (score, summary, matched/missing/adjacent skills)
- `shared/config/skill-aliases.ts` — canonical skill name map (e.g. "Apache Kafka" → "Kafka")

After editing `shared/`, always rebuild before type-checking a service:
```bash
npm run build -w @jobcheck/shared
```

## Conventions

- **Language**: All code, comments, commit messages, and documentation must be in English.
- Each service is independently runnable — no service imports from another service's directory.
- All shared types and DB clients live in `shared/` and are imported via `@jobcheck/shared`.
- LLM client (`llm/client.ts`) is instantiated once per service process, not per request.
- **CV entry point**: CVs are submitted via `POST :3007/cvs` (multipart, field name `file`). The CV service parses the file, stores it in `cvs`, then calls `POST :3002/normalize-cv` with `{ cv_id }`. The normalizer reads the text from the DB itself.
- **Do not add `extraction_status`, `embedding_status`, or any column from the old pipeline** — those tables and columns no longer exist.
