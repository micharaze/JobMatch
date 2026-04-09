import OpenAI from 'openai';

const BASE_URL = process.env.EMBEDDING_BASE_URL ?? 'http://localhost:11434/v1';
const API_KEY  = process.env.EMBEDDING_API_KEY  ?? 'ollama';
const MODEL    = process.env.EMBEDDING_MODEL    ?? 'embeddinggemma';

const embeddingClient = new OpenAI({ baseURL: BASE_URL, apiKey: API_KEY });

/** Embed multiple query-encoded skill strings. Returns vectors in the same order. */
export async function embedQueries(skills: string[]): Promise<number[][]> {
  if (skills.length === 0) return [];

  const response = await embeddingClient.embeddings.create({
    model: MODEL,
    input: skills.map((s) => `query: ${s}`),
  });

  return response.data
    .sort((a, b) => a.index - b.index)
    .map((e) => e.embedding);
}
