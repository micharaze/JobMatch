import * as cheerio from 'cheerio';
import type { JobPosting } from '@jobcheck/shared';
import { JobPostingSchema } from '@jobcheck/shared';
import { registerScraper, type Scraper } from './base';
import { cleanHtml } from '../utils/html-cleaner';
import { rateLimiter } from '../utils/rate-limiter';
import { getBrowser } from '../browser';
import logger from '../logger';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ── URL type detection ─────────────────────────────────────────────────────

type UrlType = 'portal' | 'robots';

function getUrlType(url: string): UrlType | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host !== 'solcom.de') return null;
    if (u.pathname.startsWith('/de/projektportal/projektangebote/') && /-\d+/.test(u.pathname)) return 'portal';
    if (u.pathname.startsWith('/asp/robots/') && u.searchParams.has('id')) return 'robots';
    return null;
  } catch { return null; }
}

// ── ID extraction ──────────────────────────────────────────────────────────

function extractPortalId(url: string): string {
  const match = new URL(url).pathname.match(/-(\d+)(?:[/?#]|$)/);
  if (!match) throw new Error(`Cannot extract project ID from solcom portal URL: ${url}`);
  return match[1];
}

function extractRobotsId(url: string): string {
  const id = new URL(url).searchParams.get('id');
  if (!id) throw new Error(`Cannot extract project ID from solcom robots URL: ${url}`);
  return id;
}

// ── Date conversion ────────────────────────────────────────────────────────

/** Convert German date "DD.MM.YYYY" to ISO "YYYY-MM-DD", or null if unparseable. */
function parseGermanDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// ── Fetch ──────────────────────────────────────────────────────────────────

/** solcom.de applies Cloudflare geo-IP blocking to plain HTTP requests — Playwright only. */
async function fetchHtml(url: string): Promise<string> {
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

// ── Portal parser (/de/projektportal/projektangebote/[slug]-[id]) ──────────

function parsePortal(html: string, url: string): JobPosting {
  const $ = cheerio.load(html);
  const id = extractPortalId(url);

  // Title — strip soft-hyphens inserted by the hyphenation CSS class
  const title = $('.project-header h2').text().replace(/\u00ad/g, '').trim();
  if (!title) logger.warn('solcom portal: could not extract title', { url });

  // Meta info fields by icon class
  const iconVal = (icon: string) =>
    $(`.project-infos li.${icon}-icon .icon-value`).first().text().trim();
  const location = iconVal('pin') || 'Unknown';
  const startDate = parseGermanDate(iconVal('calendar'));
  // Two bag-icons: first = Stellentyp, second = Branche
  const contractType = $('.project-infos li.bag-icon .icon-value').eq(0).text().trim() || 'freelance';

  // Description
  const rawDesc = $('.projekt-desc').html() ?? '';
  const description = cleanHtml(rawDesc);
  if (!description) logger.warn('solcom portal: could not extract description', { url });

  return JobPostingSchema.parse({
    id: `solcom:${id}`,
    source: 'solcom',
    url,
    title,
    company: 'SOLCOM',
    location,
    description,
    contract_type: contractType || undefined,
    posted_at: startDate,
    scraped_at: new Date().toISOString(),
  });
}

// ── Robots parser (/asp/robots/detail.aspx?mode=...&id=...) ───────────────

function parseRobots(html: string, url: string): JobPosting {
  const $ = cheerio.load(html);
  const id = extractRobotsId(url);

  const title = $('section.section1 h1').text().trim();
  if (!title) logger.warn('solcom robots: could not extract title', { url });

  // Info fields: <b>Label:</b> Value<br><br>
  const infosHtml = $('section.section1 .infos').html() ?? '';
  const infoMap: Record<string, string> = {};
  const infoRe = /<b>([^<:]+):<\/b>\s*([^<\n]+?)(?=\s*<br)/g;
  let m;
  while ((m = infoRe.exec(infosHtml)) !== null) {
    infoMap[m[1].trim()] = m[2].trim();
  }

  const location = infoMap['Einsatzort'] ?? 'Unknown';
  const contractType = infoMap['Stellentyp'] ?? 'freelance';
  const startDate = parseGermanDate(infoMap['Starttermin'] ?? '');

  // Description: tasks + requirements sections
  const workHtml = $('.section2 .work').html() ?? '';
  const qualHtml = $('.section2 .qualification').html() ?? '';
  const description = cleanHtml(workHtml + qualHtml);
  if (!description) logger.warn('solcom robots: could not extract description', { url });

  return JobPostingSchema.parse({
    id: `solcom:${id}`,
    source: 'solcom',
    url,
    title,
    company: 'SOLCOM',
    location,
    description,
    contract_type: contractType || undefined,
    posted_at: startDate,
    scraped_at: new Date().toISOString(),
  });
}

// ── Scraper registration ───────────────────────────────────────────────────

const solcomScraper: Scraper = {
  hostname: 'www.solcom.de',

  canHandle(url: string): boolean {
    return getUrlType(url) !== null;
  },

  async scrape(url: string): Promise<JobPosting> {
    await rateLimiter.wait(url);
    const type = getUrlType(url);
    if (!type) throw new Error(`Unsupported solcom URL format: ${url}`);
    logger.info('solcom: scraping via Playwright', { url, type });
    const html = await fetchHtml(url);
    return type === 'portal' ? parsePortal(html, url) : parseRobots(html, url);
  },
};

registerScraper(solcomScraper);
export default solcomScraper;
