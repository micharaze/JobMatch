import axios from 'axios';
import robotsParser from 'robots-parser';
import logger from '../logger';

const MIN_DELAY_MS = 2000;
const ROBOTS_TTL_MS = 60 * 60 * 1000; // 1 hour

const USER_AGENT = 'JobCheck/1.0';

interface RobotsCache {
  robots: ReturnType<typeof robotsParser>;
  fetchedAt: number;
}

const lastRequestTime = new Map<string, number>();
const robotsCache = new Map<string, RobotsCache>();

function getHostname(url: string): string {
  return new URL(url).hostname;
}

async function fetchRobots(origin: string): Promise<ReturnType<typeof robotsParser>> {
  const robotsUrl = `${origin}/robots.txt`;
  try {
    const res = await axios.get<string>(robotsUrl, {
      timeout: 5000,
      headers: { 'User-Agent': USER_AGENT },
      responseType: 'text',
    });
    return robotsParser(robotsUrl, res.data);
  } catch {
    // If robots.txt is unreachable, assume everything is allowed
    logger.warn('Could not fetch robots.txt — assuming all paths allowed', { robotsUrl });
    return robotsParser(robotsUrl, '');
  }
}

async function getRobots(url: string): Promise<ReturnType<typeof robotsParser>> {
  const { origin } = new URL(url);
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < ROBOTS_TTL_MS) {
    return cached.robots;
  }
  const robots = await fetchRobots(origin);
  robotsCache.set(origin, { robots, fetchedAt: Date.now() });
  return robots;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const rateLimiter = {
  /**
   * Enforces a minimum 2-second delay between requests to the same domain.
   * Also checks robots.txt and throws if the path is disallowed.
   */
  async wait(url: string): Promise<void> {
    const robots = await getRobots(url);
    if (!robots.isAllowed(url, USER_AGENT)) {
      throw new Error(`robots.txt disallows scraping: ${url}`);
    }

    const hostname = getHostname(url);
    const last = lastRequestTime.get(hostname) ?? 0;
    const elapsed = Date.now() - last;
    if (elapsed < MIN_DELAY_MS) {
      await sleep(MIN_DELAY_MS - elapsed);
    }
    lastRequestTime.set(hostname, Date.now());
  },
};
