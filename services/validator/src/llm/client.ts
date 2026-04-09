import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources';

const baseURL = process.env.GEMMA_BASE_URL ?? 'http://localhost:11434/v1';
const apiKey  = process.env.GEMMA_API_KEY  ?? 'ollama';

export const MODEL      = process.env.GEMMA_MODEL      ?? 'gemma4:e4b';
export const KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE ?? '5m';

export const llm = new OpenAI({ baseURL, apiKey });

// Ollama-specific extension: keep_alive controls how long the model stays in VRAM.
export type OllamaParams = ChatCompletionCreateParamsNonStreaming & { keep_alive?: string };
