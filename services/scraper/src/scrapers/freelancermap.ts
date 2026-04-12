import axios from 'axios';
import * as cheerio from 'cheerio';
import type { JobPosting } from '@jobcheck/shared';
import { JobPostingSchema } from '@jobcheck/shared';
import { registerScraper, type Scraper } from './base';
import { cleanHtml } from '../utils/html-cleaner';
import { rateLimiter } from '../utils/rate-limiter';
import { getBrowser } from '../browser';
import logger from '../logger';

const DOMAINS = new Set(['freelancermap.com', 'freelancermap.de']);
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CONTRACT_KEYWORDS = ['freelance', 'contracting', 'contract', 'full-time', 'part-time', 'festanstellung', 'permanent'];

function extractSlug(url: string): string {
  const match = url.match(/\/(?:project|projekt)\/([^/?#]+)/);
  if (!match) throw new Error(`Cannot extract slug from URL: ${url}`);
  return match[1];
}

function parseJsonLd(html: string): Record<string, unknown>[] {
  const $ = cheerio.load(html);
  const results: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try { results.push(JSON.parse($(el).html() ?? '') as Record<string, unknown>); } catch { /* ignore */ }
  });
  return results;
}

/** Parse the ISO date from the <meta name="date"> tag (most reliable). */
function parseDate(html: string): string | null {
  const $ = cheerio.load(html);
  return $('meta[name="date"]').attr('content') ?? null;
}

/**
 * Convert raw HTML to plain text preserving word boundaries.
 * Tags become spaces so adjacent elements don't run together.
 */
function htmlToSearchText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}

/** Extract email from page text via regex. Requires a word boundary after the TLD. */
function extractEmail(text: string): string | undefined {
  // (?!\w) ensures the TLD is not immediately followed by more word chars (e.g. "hays.deTelefone")
  const match = text.match(/[a-zA-Z0-9._%+\-]+@(?:[a-zA-Z0-9\-]+\.)+[a-zA-Z]{2,6}(?!\w)/);
  if (match && !match[0].includes('@freelancermap')) {
    return match[0];
  }
  return undefined;
}

/** Extract German phone number from page text via regex. */
function extractPhone(text: string): string | undefined {
  const match = text.match(/\+\s*49[\s\d\-./()]{6,20}\d/);
  return match ? match[0].trim() : undefined;
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
    logger.warn('freelancermap: HTTP fetch failed, falling back to Playwright', { url, err });
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
  const $ = cheerio.load(html);
  const slug = extractSlug(url);
  const bodyText = $.root().text();

  // ── Title ────────────────────────────────────────────────────────────────
  const title = $('h1').first().text().trim();
  if (!title) logger.warn('freelancermap: could not extract title', { url });

  // ── Company (client) ─────────────────────────────────────────────────────
  // JSON-LD has @type Organization with the company name
  const jsonLds = parseJsonLd(html);
  const orgLd = jsonLds.find(d => d['@type'] === 'Organization') as { name?: string } | undefined;
  const company = orgLd?.name
    ?? $('.project-info-title a').first().text().trim()
    ?? 'Unknown';

  // ── Author / contact person ───────────────────────────────────────────────
  const author = $('.project-info-name').first().text().trim() || undefined;

  // ── Location ─────────────────────────────────────────────────────────────
  // JSON-LD has @type Place with addressLocality
  const placeLd = jsonLds.find(d => d['@type'] === 'Place') as { address?: { addressLocality?: string } } | undefined;
  const location = placeLd?.address?.addressLocality
    // Fallback: first badge that doesn't match contract/time keywords
    ?? ($('.badge').toArray()
        .map(el => $(el).text().trim())
        .find(t => t.includes(',') || t.toLowerCase() === 'remote')
      )
    ?? 'Unknown';

  // ── Description ──────────────────────────────────────────────────────────
  const rawDesc = $('[class*=description]').first().html() ?? '';
  const description = cleanHtml(rawDesc);
  if (!description) logger.warn('freelancermap: could not extract description', { url });

  // ── Contract type ─────────────────────────────────────────────────────────
  const contractType = $('.badge').toArray()
    .map(el => $(el).text().trim())
    .find(t => CONTRACT_KEYWORDS.some(k => t.toLowerCase().includes(k)))
    ?? 'freelance';

  // ── Date posted ───────────────────────────────────────────────────────────
  const postedAt = parseDate(html);

  // ── Email and phone ───────────────────────────────────────────────────────
  // Plain text in the description — use tag-stripped HTML so word boundaries are preserved
  const searchText = htmlToSearchText(rawDesc || html);
  const authorEmail = extractEmail(searchText);
  const authorTel = extractPhone(searchText);

  return JobPostingSchema.parse({
    id: `freelancermap:${slug}`,
    source: 'freelancermap',
    url,
    author: author || undefined,
    author_company: company !== 'Unknown' ? company : undefined,
    author_email: authorEmail,
    author_tel: authorTel,
    title,
    company,
    location: typeof location === 'string' ? location : 'Unknown',
    description,
    contract_type: contractType,
    posted_at: postedAt,
    scraped_at: new Date().toISOString(),
  });
}

const freelancermapScraper: Scraper = {
  hostname: 'www.freelancermap.com',

  canHandle(url: string): boolean {
    try { return DOMAINS.has(new URL(url).hostname.replace(/^www\./, '')); } catch { return false; }
  },

  async scrape(url: string): Promise<JobPosting> {
    await rateLimiter.wait(url);
    const html = await fetchHtml(url);
    return parse(html, url);
  },
};

registerScraper(freelancermapScraper);
export default freelancermapScraper;
