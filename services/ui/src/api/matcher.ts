import type { MatchResult } from '../types';

const BASE = import.meta.env.VITE_MATCHER_URL ?? 'http://localhost:3004';

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const matcherApi = {
  processPending(): Promise<{ pending: number; message: string }> {
    return json(`${BASE}/process-pending`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  },

  listMatches(opts: { cvId?: string; postingId?: string; limit?: number } = {}): Promise<MatchResult[]> {
    const params = new URLSearchParams();
    if (opts.cvId) params.set('cv_id', opts.cvId);
    if (opts.postingId) params.set('posting_id', opts.postingId);
    if (opts.limit) params.set('limit', String(opts.limit));
    return json(`${BASE}/matches?${params.toString()}`);
  },

  getMatch(postingId: string, cvId: string): Promise<MatchResult> {
    return json(
      `${BASE}/matches/${encodeURIComponent(postingId)}/${encodeURIComponent(cvId)}`,
    );
  },
};
