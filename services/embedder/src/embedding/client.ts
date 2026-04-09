import OpenAI from 'openai';
import logger from '../logger';

export const BASE_URL   = process.env.EMBEDDING_BASE_URL ?? 'http://localhost:11434/v1';
export const API_KEY    = process.env.EMBEDDING_API_KEY  ?? 'ollama';
export const MODEL      = process.env.EMBEDDING_MODEL    ?? 'embeddinggemma';
export const DIM        = Number(process.env.EMBEDDING_DIM ?? 768);
export const BATCH_SIZE = Number(process.env.EMBEDDING_BATCH_SIZE ?? 32);

export const embeddingClient = new OpenAI({ baseURL: BASE_URL, apiKey: API_KEY });

// Strip /v1 suffix to get the Ollama native API base URL
const OLLAMA_BASE = BASE_URL.replace(/\/v1\/?$/, '');

/** Unload the embedding model from Ollama memory. */
export async function unloadModel(): Promise<void> {
  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ model: MODEL, keep_alive: 0, prompt: '' }),
  });
  if (!res.ok) throw new Error(`Ollama unload → ${res.status} ${res.statusText}`);
  logger.info('Embedding model unloaded', { model: MODEL });
}
