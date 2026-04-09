# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Status: Planning phase** — directory structure and services are not yet implemented.

## Project: JobMatch — Recruiting Matcher

A pipeline-based recruiting system that matches job postings to CVs via AI-powered skill extraction and semantic search. Each pipeline stage is an independent **Node.js + TypeScript** service. The frontend is **React + TypeScript**.

### Pipeline Architecture

```
Job Postings (scraped)              CVs (uploaded via UI)
       │                                    │
       ▼                                    │
[1] Scraper Service                         │
       │  fetches & normalizes              │
       │  job postings                      │
       ▼                                    ▼
[2] Skill Extractor  ←  Gemma 4 E4B extracts structured skills
       │                 from BOTH job postings AND CVs
       │                                    │
       ▼                                    ▼
[3] Embedding Service ← EmbeddingGemma encodes all extracted
       │                 skills → vector DB (asymmetric formatting)
       ▼
[4] Matcher / Retrieval Service
       │  finds nearest CV skills for each job skill
       │  via vector similarity
       ▼
[5] Validation / Rerank Service
       │  Gemma 4 E4B checks top candidates via function calling,
       │  labels exact / semantic / uncertain, adds reasoning
       ▼
[6] Scoring Service
       │  deterministic weighted scoring of validated matches
       ▼
[7] UI / API Service
       React + TypeScript frontend + API gateway;
       also exposes endpoints for CV upload and manual DB edits
```

**Important**: CVs must pass through steps 2 and 3 (extraction + embedding) before any matching in step 4 is valid. The extractor produces the same structured skill schema for both job postings and CVs.

### Model Responsibility Split

| Model              | Role                                                                          |
| ------------------ | ----------------------------------------------------------------------------- |
| **Gemma 4 E4B**    | Extraction from job postings AND CVs, validation/reranking — steps 2 and 5    |
| **EmbeddingGemma** | Semantic similarity — steps 3 and 4 (asymmetric query-vs-document formatting) |

The vector index handles candidate retrieval in step 4; Gemma 4 only sees the top-k results and validates them — it does not search the vector space directly.

See `.claude/rules/` for specific rules — load only what is relevant to the current service:

| Rule file              | When to load                |
| ---------------------- | --------------------------- |
| `scraper-rules.md`     | Working in `scraper/`       |
| `extraction-schema.md` | Working in `extractor/`     |
| `embedding-rules.md`   | Working in `embedder/`      |
| `matcher-rules.md`     | Working in `matcher/`       |
| `validation-rules.md`  | Working in `validator/`     |
| `scoring-rules.md`     | Working in `scorer/`        |

## Commands

```bash
# Install all dependencies (from repo root)
npm install

# Start all services (Docker)
docker compose up

# Run a single service in development
cd services/<service-name>
npm run dev

# Run tests for a service
cd services/<service-name>
npm test

# Run all tests from root
npm test

# Lint / format
npm run lint
npm run format
```

## Service Layout

```
services/
  scraper/      # Job posting fetcher + normalizer
  extractor/    # Gemma 4 E4B skill extraction (job postings AND CVs)
  embedder/     # EmbeddingGemma encoding + vector DB writes
  matcher/      # Vector similarity retrieval
  validator/    # Gemma 4 E4B reranking and label assignment via function calling
  scorer/       # Deterministic weighted scoring
  ui/           # React + TypeScript frontend + API gateway (CV upload, manual DB mgmt)
shared/         # TypeScript types/interfaces, Zod schemas, LLM client abstractions, DB clients
```

## Conventions

- **Language**: All backend services use Node.js + TypeScript. The frontend uses React + TypeScript. All code — variable names, comments, commit messages, and documentation — must be written in English.
- **i18n**: The application is designed for multi-language support. For now, only English is implemented. Use a localization framework (e.g. `i18next`) from the start so adding more languages later requires no structural changes. Keep all user-facing strings in translation files, never hardcode them in components or services.
- Each service is independently runnable and testable — no service imports from another service's directory.
- All TypeScript types, Zod validation schemas, LLM client wrappers, and DB clients live in `shared/` and are imported by all services.
- Gemma model connections are initialized once at service startup, not per-request.
- Both job skills and CV skills must be extracted (step 2) and embedded (step 3) before retrieval in step 4 is valid.
- CVs follow the same extraction pipeline as job postings — the extractor handles both input types.
