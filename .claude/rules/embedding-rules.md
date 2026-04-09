# EmbeddingGemma — Asymmetric Query-vs-Document Formatting

Relevant for: `services/embedder/`, `services/matcher/`, any code that calls EmbeddingGemma.

Source of truth: `shared/schemas/embedding.ts` — this rule documents the contract, but the Zod schema in `shared/` is authoritative.

## Rule

Job skill queries and CV skill documents MUST be encoded with different prefixes.
Never encode both sides with the same prompt format — this degrades retrieval quality.

## Prefixes

| Side                      | Prefix      |
| ------------------------- | ----------- |
| Query (job skill lookup)  | `query: `   |
| Document (CV skill entry) | `passage: ` |

## Usage

```typescript
function encodeQuery(text: string): string {
  return `query: ${text}`;
}

function encodeDocument(text: string): string {
  return `passage: ${text}`;
}
```

## What gets encoded where

- **Step 3 (Embedding Service)**: CV skills → `encodeDocument()`; Job skills → `encodeDocument()`
- **Step 4 (Matcher)**: Job skill lookup at query time → `encodeQuery()`

Both job and CV skills are stored as documents in the vector DB.
Only at retrieval time does the job skill become a query.

## Dimension-Specific Similarity Thresholds (Step 4 — Matcher)

Vector similarity is semantically blind to dimension context: React and Angular are "close"
in the vector space because both are JavaScript frontend frameworks — but for recruiting
purposes they are NOT interchangeable. C and Go are similarly close, yet a job requiring C
does not match a Go developer well.

To prevent false positives, the matcher MUST apply **per-dimension minimum cosine similarity
thresholds**. Skills below the threshold for their dimension are dropped before the validator
ever sees them.

| Dimension              | Min. Cosine Similarity | Rationale                                      |
| ---------------------- | ---------------------- | ---------------------------------------------- |
| `programming_languages`| **0.92**               | Strict — C ≠ Go, Python ≠ Ruby                 |
| `tools`                | **0.90**               | Strict — React ≠ Angular, MSBuild ≠ Gradle     |
| `infrastructure`       | **0.88**               | Strict-ish — AWS ≠ GCP, but Docker ≈ Podman    |
| `project_management`   | **0.85**               | Medium — Jira ≈ YouTrack, Scrum ≈ Kanban ok   |
| `domain_knowledge`     | **0.82**               | Medium — conceptual overlap is acceptable      |
| `spoken_languages`     | **0.95**               | Very strict — English ≠ German                 |
| `soft_skills`          | **0.75**               | Loose — "Communication" ≈ "Collaboration" ok   |

These thresholds are defined in `shared/config/matching.ts` (single source of truth).
Never hardcode them in the matcher service logic.

## Why the Embedder Still Makes Sense

Even with strict thresholds, vector retrieval is orders of magnitude faster than asking an
LLM to compare every possible job-skill × CV-skill pair directly. The embedder + matcher
act as a fast pre-filter; the validator (Step 5) does the precise judgement on the
remaining candidates only. Without this two-stage design, validation would require millions
of LLM calls for any realistic dataset.
