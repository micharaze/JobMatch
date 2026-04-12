import type { LLMPingResult, NormalizerStats } from '../types';

const BASE = import.meta.env.VITE_NORMALIZER_URL ?? 'http://localhost:3002';

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const normalizerApi = {
  processPending(limit = 50): Promise<{ claimed: number; message: string }> {
    return json(`${BASE}/process-pending`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit }),
    });
  },

  getStats(): Promise<NormalizerStats> {
    return json(`${BASE}/stats`);
  },

  llmPing(): Promise<LLMPingResult> {
    return json(`${BASE}/llm-ping`);
  },

  getLLMStatus(): Promise<{ provider: string; model: string; hasApiKey: boolean }> {
    return json(`${BASE}/status`);
  },
};
