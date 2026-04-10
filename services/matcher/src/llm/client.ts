import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources';

export const LLM_PROVIDER = (process.env.LLM_PROVIDER ?? 'ollama') as 'ollama' | 'gemini';
export const IS_OLLAMA     = LLM_PROVIDER === 'ollama';

const baseURL = IS_OLLAMA
  ? (process.env.GEMMA_BASE_URL ?? 'http://localhost:11434/v1')
  : 'https://generativelanguage.googleapis.com/v1beta/openai/';

const apiKey = IS_OLLAMA
  ? (process.env.GEMMA_API_KEY  ?? 'ollama')
  : (process.env.GEMINI_API_KEY ?? '');

export const MODEL = IS_OLLAMA
  ? (process.env.MATCHER_MODEL || process.env.GEMMA_MODEL || 'gemma4:e4b')
  : (process.env.MATCHER_MODEL || process.env.GEMINI_MODEL || 'gemini-2.0-flash');

export const KEEP_ALIVE = IS_OLLAMA
  ? (process.env.OLLAMA_KEEP_ALIVE ?? '5m')
  : undefined;

export const llm = new OpenAI({ baseURL, apiKey });

export type OllamaParams = ChatCompletionCreateParamsNonStreaming & { keep_alive?: string };
