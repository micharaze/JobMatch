# Scraper — Job Posting Fetcher

Relevant for: `services/scraper/`

Source of truth: `shared/schemas/job-posting.ts` — this rule documents the contract, but the Zod schema in `shared/` is authoritative.

## Rule

The scraper fetches job postings from external sources and normalizes them into a standard schema before passing them to the extractor (step 2).

## Output Schema

```json
{
  "id": "string — unique identifier (source + external ID)",
  "source": "string — origin platform name",
  "url": "string — original posting URL",
  "author": "string — name of the poster",
  "author_company": "string — company name of the poster (if available)",
  "author_email": "string — contact email of the poster (if available)",
  "author_tel": "string — contact phone number of the poster (if available)",
  "title": "string — job title",
  "company": "string — company name",
  "location": "string — location or 'remote'",
  "description": "string — full job description text (cleaned HTML)",
  "contract_type": "string — e.g. 'full-time', 'part-time', 'contract', etc.",
  "posted_at": "string — ISO 8601 date or null",
  "scraped_at": "string — ISO 8601 timestamp",
  "raw_html": "string — original HTML before cleaning (optional, for debugging)"
}
```

## Playwright Fallback

If a page cannot be scraped via a normal HTTP request (fetch/axios) — e.g. due to JavaScript rendering, anti-bot protection, Cloudflare, or similar server restrictions — use **Playwright** as a fallback.

- Always attempt the lightweight HTTP request first.
- Only switch to Playwright on failure (empty page, CAPTCHA, 403/429, JS-only content).
- Run Playwright in headless mode.
- Rate limiting and User-Agent rules (see below) still apply when using Playwright.

## Conventions

- **Rate limiting**: Respect `robots.txt` and enforce a minimum delay between requests (default: 2s). Never run parallel requests against the same domain.
- **User-Agent**: Always set a descriptive User-Agent header. Never use the default Node.js User-Agent.
- **Deduplication**: Use `source + external_id` as the composite key. Skip postings that already exist in the DB.
- **HTML cleaning**: Strip all tags, scripts, and styles from `description`. Preserve paragraph breaks as `\n\n`. Do not strip list formatting — convert `<li>` to `- `.
- **Error handling**: Log and skip individual postings that fail to parse. Never let one bad posting abort the entire scrape run.
- **Idempotency**: Re-running the scraper for the same source and time range must not create duplicate entries.

## What NOT to do

- Do not extract skills in the scraper — that is step 2 (extractor).
- Do not embed or vectorize anything — that is step 3 (embedder).
- Do not store raw HTML in production unless explicitly configured for debugging.
