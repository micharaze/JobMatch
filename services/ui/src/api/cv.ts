import type { CvMeta } from '../types';

const BASE = import.meta.env.VITE_CV_URL ?? 'http://localhost:3007';

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const cvApi = {
  upload(file: File): Promise<{ cv_id: string; original_name: string; extraction_status: string }> {
    const form = new FormData();
    form.append('file', file);
    return json(`${BASE}/cvs`, { method: 'POST', body: form });
  },

  list(limit = 50): Promise<CvMeta[]> {
    return json(`${BASE}/cvs?limit=${limit}`);
  },

  get(id: string): Promise<CvMeta> {
    return json(`${BASE}/cvs/${encodeURIComponent(id)}`);
  },

  delete(id: string): Promise<{ ok: boolean; cv_id: string }> {
    return json(`${BASE}/cvs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};
