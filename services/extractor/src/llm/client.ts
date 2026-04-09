import OpenAI from 'openai';

const baseURL = process.env.GEMMA_BASE_URL ?? 'http://localhost:11434/v1';
const apiKey  = process.env.GEMMA_API_KEY  ?? 'ollama';

export const MODEL = process.env.GEMMA_MODEL ?? 'gemma4:e4b';

export const llm = new OpenAI({ baseURL, apiKey });
