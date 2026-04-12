import axios from 'axios';
import * as cheerio from 'cheerio';
import type { JobPosting } from '@jobcheck/shared';
import { JobPostingSchema } from '@jobcheck/shared';
import { registerScraper, type Scraper } from './base';
import { cleanHtml } from '../utils/html-cleaner';
import { rateLimiter } from '../utils/rate-limiter';
import { getBrowser } from '../browser';
import logger from '../logger';

const DOMAIN = 'xing.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Extract the numeric job ID from the end of the URL path. */
function extractId(url: string): string {
  const match = new URL(url).pathname.match(/-(\d+)$/);
  if (!match) throw new Error(`Cannot extract ID from XING URL: ${url}`);
  return match[1];
}

function parseJsonLd(html: string): Record<string, unknown> | null {
  const $ = cheerio.load(html);
  let result: Record<string, unknown> | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (result) return;
    try {
      const d = JSON.parse($(el).html() ?? '') as Record<string, unknown>;
      if (d['@type'] === 'JobPosting') result = d;
    } catch { /* ignore */ }
  });
  return result;
}

async function fetchHtml(url: string): Promise<string> {
  try {
    const res = await axios.get<string>(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 12_000,
      responseType: 'text',
    });
    if (!res.data || res.data.length < 1000) {
      throw new Error('Response too short — likely blocked');
    }
    return res.data;
  } catch (err) {
    logger.warn('xing: HTTP fetch failed, falling back to Playwright', { url, err });
    return fetchWithPlaywright(url);
  }
}

async function fetchWithPlaywright(url: string): Promise<string> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({ 'User-Agent': USER_AGENT });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    return await page.content();
  } finally {
    await page.close();
  }
}

function parse(html: string, url: string): JobPosting {
  const id = extractId(url);
  const ld = parseJsonLd(html);

  if (!ld) throw new Error(`xing: no JobPosting JSON-LD found for ${url}`);

  const title = (ld['title'] as string | undefined)?.trim() ?? '';
  if (!title) logger.warn('xing: could not extract title', { url });

  const org = ld['hiringOrganization'] as { name?: string } | undefined;
  const company = org?.name?.trim() ?? 'Unknown';

  const locations = ld['jobLocation'] as Array<{ address?: { addressLocality?: string; addressCountry?: string } }> | undefined;
  const locality = locations?.[0]?.address?.addressLocality?.trim();
  const country = locations?.[0]?.address?.addressCountry?.trim();
  const location = locality
    ? (country && country !== 'DE' ? `${locality}, ${country}` : locality)
    : 'Unknown';

  const rawDesc = (ld['description'] as string | undefined) ?? '';
  const description = cleanHtml(rawDesc);
  if (!description) logger.warn('xing: could not extract description', { url });

  const employmentType = (ld['employmentType'] as string | undefined) ?? '';
  const contractType = normalizeEmploymentType(employmentType);

  const datePosted = (ld['datePosted'] as string | undefined) ?? null;

  return JobPostingSchema.parse({
    id: `xing:${id}`,
    source: 'xing',
    url,
    title,
    company,
    location,
    description,
    contract_type: contractType || undefined,
    posted_at: datePosted ? datePosted.slice(0, 10) : null,
    scraped_at: new Date().toISOString(),
  });
}

function normalizeEmploymentType(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('selbst') || lower.includes('freelan') || lower.includes('freiberuf')) return 'freelance';
  if (lower.includes('full') || lower.includes('vollzeit')) return 'full-time';
  if (lower.includes('part') || lower.includes('teilzeit')) return 'part-time';
  if (lower.includes('contract')) return 'contract';
  return raw;
}

const xingScraper: Scraper = {
  hostname: 'www.xing.com',

  canHandle(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '') === DOMAIN && parsed.pathname.startsWith('/jobs/');
    } catch { return false; }
  },

  async scrape(url: string): Promise<JobPosting> {
    await rateLimiter.wait(url);
    const html = await fetchHtml(url);
    return parse(html, url);
  },
};

registerScraper(xingScraper);
export default xingScraper;
