export interface JobPosting {
  id: string;
  source: string;
  url: string;
  author?: string | null;
  author_company?: string | null;
  author_email?: string | null;
  author_tel?: string | null;
  title: string;
  company: string;
  location: string;
  description: string;
  contract_type?: string | null;
  posted_at?: string | null;
  scraped_at: string;
  normalized_text?: string | null;
  normalization_status?: string | null;
  extraction_status?: string | null;
}

export interface CvMeta {
  id: string;
  original_name: string;
  mime_type: string;
  uploaded_at: string;
  extraction_status: 'pending' | 'processing' | 'done' | 'error';
  normalization_status: 'pending' | 'processing' | 'done' | 'error' | null;
  error?: string | null;
}

export interface MatchResult {
  posting_id: string;
  cv_id: string;
  score: number;
  summary: string;
  matched_skills: string[];
  missing_skills: string[];
  adjacent_skills: string[];
  model: string;
  matched_at: string;
}

export interface ScrapeResult {
  scraped: number;
  skipped: number;
  errors: Array<{ url: string; error: string }>;
}

export interface LLMPingResult {
  ok: boolean;
  provider: 'ollama' | 'gemini';
  model: string;
  status: 'ready' | 'loaded' | 'installed' | 'not_installed' | 'unreachable' | 'no_api_key';
  error?: string;
}

export interface NormalizerStats {
  pending: number;
  processing: number;
  done: number;
  error: number;
}

export type BatchStep = 'idle' | 'scraping' | 'normalizing' | 'matching' | 'done' | 'error';

export interface BatchState {
  step: BatchStep;
  cvId: string;
  urls: string[];
  scrapedCount: number;
  skippedCount: number;
  scrapeErrors: Array<{ url: string; error: string }>;
  matchesFound: number;
  errorMessage?: string;
}

export interface Settings {
  provider: 'ollama' | 'gemini';
  ollamaBaseUrl: string;
  ollamaModel: string;
  geminiApiKey: string;
  geminiModel: string;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'ollama',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'gemma4:e4b',
  geminiApiKey: '',
  geminiModel: 'gemini-2.0-flash',
};
