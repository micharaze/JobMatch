# Gemma 4 E4B — Skill Extraction Schema

Relevant for: `services/extractor/`

Source of truth: `shared/schemas/extraction.ts` — this rule documents the contract, but the Zod schema in `shared/` is authoritative.

## Rule

Gemma 4 E4B must return structured JSON for all skill extraction.
Use function calling or constrained output — never parse unstructured text.

**Both job postings and CVs** go through this extractor. The same schema is produced for both input types — only the `source_type` field differs.

## Output Schema

Each skill dimension is a **SkillSet** object with `required` and `preferred` arrays:

```json
{
  "source_type": "job_posting | cv",
  "domain_knowledge":      { "required": ["string"], "preferred": ["string"] },
  "programming_languages": { "required": ["string"], "preferred": ["string"] },
  "tools":                 { "required": ["string"], "preferred": ["string"] },
  "infrastructure":        { "required": ["string"], "preferred": ["string"] },
  "project_management":    { "required": ["string"], "preferred": ["string"] },
  "spoken_languages":      { "required": ["string"], "preferred": ["string"] },
  "soft_skills":           { "required": ["string"], "preferred": ["string"] },
  "experience_level": "junior | mid | senior | lead | null"
}
```

## Field Definitions

| Field | What belongs here | Examples |
|-------|------------------|---------|
| `domain_knowledge` | Technical knowledge areas (concepts, not tools) | "Build Pipelines", "CI/CD", "Compilation", "Machine Learning", "REST API Design" |
| `programming_languages` | Programming and scripting languages | "C++", "Python", "TypeScript", "SQL", "PowerShell", "Bash" |
| `tools` | Dev tools, IDEs, frameworks, libraries | "React", "Vue", "Angular", "MSBuild", "Visual Studio", "PyTorch", "Jest", "SCons", "Conan" |
| `infrastructure` | Cloud providers, CI/CD systems, containers, orchestration | "AWS", "Azure", "GCP", "Jenkins", "GitHub Actions", "Azure DevOps", "Docker", "Kubernetes", "Terraform" |
| `project_management` | PM tools and methodologies | "Jira", "Confluence", "Scrum", "Kanban", "Agile", "SAFe" |
| `spoken_languages` | Human spoken/written languages only | "English", "German", "French" |
| `soft_skills` | Interpersonal and organizational skills | "Communication", "Team Leadership", "Mentoring" |
| `experience_level` | Seniority level inferred from context | "junior" \| "mid" \| "senior" \| "lead" \| null |

## Category Boundaries

- **`tools` vs `infrastructure`**: React, PyTorch, MSBuild → `tools`; AWS, Docker, Jenkins → `infrastructure`
- **`tools` vs `programming_languages`**: TypeScript, Python → `programming_languages`; React, NumPy → `tools`
- **`infrastructure` vs `domain_knowledge`**: "Docker" → `infrastructure`; "Containerisation" as a concept → `domain_knowledge`
- **`project_management` vs `soft_skills`**: "Jira" → `project_management`; "Communication" → `soft_skills`; "Agile" (methodology) → `project_management`

## Required vs Preferred

| Context | `required` | `preferred` |
|---------|-----------|------------|
| **Job postings** | Mandatory, "solid experience", essential | "nice to have", "helpful", "a plus", "preferred", "would be helpful" |
| **CVs** | Clearly demonstrated skills | Briefly mentioned, basic exposure only |

## Notes

- Normalize skill names to title case before storing (e.g. `"python"` → `"Python"`).
- Preserve all-caps acronyms as-is: `SQL`, `REST`, `API`, `AWS`, `CI/CD`.
- Empty arrays are valid — never omit a field or a `required`/`preferred` key.
- `experience_level` is inferred from context ("5+ years" → senior, "entry-level" → junior). Set to `null` if not determinable.
- Do not duplicate items across categories.

## API Endpoints

Service port: **3002**

| Method | Path | Body / Query | Response |
| ------ | ---- | ------------ | -------- |
| `GET`  | `/health` | — | `{ status: 'ok' }` |
| `POST` | `/extract` | `{ posting_id: string }` | `ExtractionResult` — synchronous, blocks until extraction is complete |
| `POST` | `/process-pending` | `{ limit?: number }` (default 50, max 200) | `{ claimed: number, message: string }` — responds immediately, processes in background |
| `GET`  | `/extractions` | `?limit=&offset=` | `ExtractionRow[]` — paginated list of all extraction results |
| `GET`  | `/extractions/:posting_id` | — | `ExtractionRow` or 404 |
### POST /extract — notes
- Returns 409 if the posting is not in `pending` state (already processing, done, or errored).
- Returns 404 if the `posting_id` does not exist in `job_postings`.
- Marks the posting as `processing` before calling the LLM; marks `done` or `error` after.

### POST /process-pending — notes
- Claims up to `limit` pending postings atomically (no race conditions with concurrent calls).
- Processes in background after the HTTP response is sent.
- `claimed` is the number of postings started — not the number successfully completed.
