import type { JobPosting, ScrapeResult } from '../types';

const BASE = import.meta.env.VITE_SCRAPER_URL ?? 'http://localhost:3001';

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const scraperApi = {
  scrape(urls: string[]): Promise<ScrapeResult> {
    return json(`${BASE}/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
  },

  listPostings(limit = 200): Promise<JobPosting[]> {
    return json(`${BASE}/postings?limit=${limit}`);
  },

  getPosting(id: string): Promise<JobPosting> {
    return json(`${BASE}/postings/${encodeURIComponent(id)}`);
  },

  deletePostings(urls: string[]): Promise<{ deleted: number; not_found: number }> {
    return json(`${BASE}/postings`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
  },
};
