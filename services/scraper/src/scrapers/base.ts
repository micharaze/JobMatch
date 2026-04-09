import type { JobPosting } from '@jobcheck/shared';

export interface Scraper {
  /** Human-readable hostname this scraper handles (used for error messages). */
  readonly hostname: string;
  /** Return true if this scraper can handle the given URL. */
  canHandle(url: string): boolean;
  scrape(url: string): Promise<JobPosting>;
}

const registry: Scraper[] = [];

export function registerScraper(scraper: Scraper): void {
  registry.push(scraper);
}

/** Find the scraper that can handle this URL, or undefined. */
export function scraperFor(url: string): Scraper | undefined {
  return registry.find(s => s.canHandle(url));
}

/** List all registered hostnames (for 400 error responses). */
export function registeredHostnames(): string[] {
  return registry.map(s => s.hostname);
}
