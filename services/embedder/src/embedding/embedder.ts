import { embeddingClient, MODEL, BATCH_SIZE } from './client';
import logger from '../logger';

/**
 * Encode a skill for storage (document side of asymmetric retrieval).
 * The matcher (step 4) uses "query: " prefix at retrieval time.
 */
function encodeDocument(skill: string): string {
  return `passage: ${skill}`;
}

/** Embed a batch of skills. Returns vectors in the same order. */
export async function embedSkills(skills: string[]): Promise<number[][]> {
  if (skills.length === 0) return [];

  const vectors: number[][] = [];

  for (let i = 0; i < skills.length; i += BATCH_SIZE) {
    const batch = skills.slice(i, i + BATCH_SIZE).map(encodeDocument);
    logger.debug('Embedding batch', { start: i, size: batch.length });

    const response = await embeddingClient.embeddings.create({
      model: MODEL,
      input: batch,
    });

    // Response preserves input order per OpenAI spec
    const batchVectors = response.data
      .sort((a, b) => a.index - b.index)
      .map((e) => e.embedding);

    vectors.push(...batchVectors);
  }

  return vectors;
}

/** Embed a single skill string. */
export async function embedSkill(skill: string): Promise<number[]> {
  const [vector] = await embedSkills([skill]);
  if (!vector) throw new Error(`No embedding returned for skill: ${skill}`);
  return vector;
}
