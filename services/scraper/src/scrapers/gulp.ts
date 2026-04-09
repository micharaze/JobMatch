import type { JobPosting } from '@jobcheck/shared';
import { JobPostingSchema } from '@jobcheck/shared';
import { registerScraper, type Scraper } from './base';
import { cleanHtml } from '../utils/html-cleaner';
import { rateLimiter } from '../utils/rate-limiter';
import { getBrowser } from '../browser';
import logger from '../logger';

const HOSTNAME = 'www.gulp.de';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Extract job ID from gulp URL: /gulp2/g/jobs/C01263111 → C01263111 */
function extractJobId(url: string): string {
  const match = url.match(/\/jobs\/(C\d+)/);
  if (!match) throw new Error(`Cannot extract job ID from gulp URL: ${url}`);
  return match[1];
}

/** Map JSON-LD employmentType array to human-readable string. */
function mapEmploymentType(types: string[]): string {
  const map: Record<string, string> = {
    FULL_TIME: 'full-time',
    PART_TIME: 'part-time',
    CONTRACTOR: 'contract',
    TEMPORARY: 'contract',
    INTERN: 'internship',
    VOLUNTEER: 'volunteer',
    PER_DIEM: 'per diem',
    OTHER: 'other',
  };
  return types.map(t => map[t] ?? t.toLowerCase()).join(', ');
}

/** Strip honorific prefixes (Frau/Herr/Mr/Ms) from a name. */
function stripHonorific(name: string): string {
  return name.replace(/^\s*(Frau|Herr|Mr\.?|Ms\.?|Mrs\.?)\s+/i, '').trim();
}

interface GulpJobData {
  title: string;
  company: string;
  location: string;
  description: string;
  postedAt: string | null;
  contractType: string;
  author: string | undefined;
  authorEmail: string | undefined;
  authorTel: string | undefined;
}

async function scrapeWithPlaywright(url: string): Promise<GulpJobData> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({ 'User-Agent': USER_AGENT });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
    await page.waitForTimeout(1_500);

    const data = await page.evaluate(() => {
      // ── JSON-LD (most reliable data source) ────────────────────────────
      const jsonLdScripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
      const jsonLds = jsonLdScripts
        .map(el => { try { return JSON.parse(el.textContent ?? ''); } catch { return null; } })
        .filter(Boolean);
      const jobLd = jsonLds.find((d: Record<string, unknown>) => d['@type'] === 'JobPosting') as Record<string, unknown> | undefined;

      // ── Contact info via stable data-testid attributes ──────────────────
      const emailHref = (document.querySelector('a[data-testid="contactEmailLink"]') as HTMLAnchorElement | null)?.href ?? '';
      const phoneHref = (document.querySelector('a[data-testid="contactPhoneLink"]') as HTMLAnchorElement | null)?.href ?? '';
      const authorRaw = document.querySelector('[data-testid="contactPersonFullName"]')?.textContent?.trim() ?? '';

      return { jobLd, emailHref, phoneHref, authorRaw };
    });

    if (!data.jobLd) {
      logger.warn('gulp: no JSON-LD JobPosting found', { url });
    }

    const ld = (data.jobLd ?? {}) as Record<string, unknown>;

    // ── Title ──────────────────────────────────────────────────────────────
    const title = (ld['title'] as string | undefined) ?? '';
    if (!title) logger.warn('gulp: could not extract title', { url });

    // ── Company ────────────────────────────────────────────────────────────
    const hiring = ld['hiringOrganization'] as Record<string, unknown> | undefined;
    const company = (hiring?.['name'] as string | undefined) ?? 'Unknown';

    // ── Location ───────────────────────────────────────────────────────────
    const jobLoc = ld['jobLocation'] as Record<string, unknown> | undefined;
    const addr = jobLoc?.['address'] as Record<string, unknown> | undefined;
    const postalCode = (addr?.['postalCode'] as string | undefined) ?? '';
    const locality = (addr?.['addressLocality'] as string | undefined) ?? '';
    const location = postalCode ? `${postalCode} ${locality}`.trim() : (locality || 'Unknown');

    // ── Description ────────────────────────────────────────────────────────
    const rawDesc = (ld['description'] as string | undefined) ?? '';
    const description = cleanHtml(rawDesc);
    if (!description) logger.warn('gulp: could not extract description', { url });

    // ── Date posted ────────────────────────────────────────────────────────
    const postedAt = (ld['datePosted'] as string | undefined) ?? null;

    // ── Contract type ──────────────────────────────────────────────────────
    const empTypes = ld['employmentType'];
    const contractType = Array.isArray(empTypes)
      ? mapEmploymentType(empTypes as string[])
      : typeof empTypes === 'string' ? empTypes.toLowerCase() : 'contract';

    // ── Author ─────────────────────────────────────────────────────────────
    const author = data.authorRaw ? stripHonorific(data.authorRaw) : undefined;

    // ── Email / Tel ────────────────────────────────────────────────────────
    const authorEmail = data.emailHref.replace('mailto:', '') || undefined;
    const authorTel = data.phoneHref.replace('tel:', '').replace(/-/g, ' ').trim() || undefined;

    return { title, company, location, description, postedAt, contractType, author, authorEmail, authorTel };
  } finally {
    await page.close();
  }
}

const gulpScraper: Scraper = {
  hostname: HOSTNAME,

  canHandle(url: string): boolean {
    try { return new URL(url).hostname === HOSTNAME; } catch { return false; }
  },

  async scrape(url: string): Promise<JobPosting> {
    await rateLimiter.wait(url);
    const jobId = extractJobId(url);
    const d = await scrapeWithPlaywright(url);

    return JobPostingSchema.parse({
      id: `gulp:${jobId}`,
      source: 'gulp',
      url,
      author: d.author,
      author_company: undefined, // contact person is the recruiter, company is in 'company'
      author_email: d.authorEmail,
      author_tel: d.authorTel,
      title: d.title,
      company: d.company,
      location: d.location,
      description: d.description,
      contract_type: d.contractType,
      posted_at: d.postedAt,
      scraped_at: new Date().toISOString(),
    });
  },
};

registerScraper(gulpScraper);
export default gulpScraper;
