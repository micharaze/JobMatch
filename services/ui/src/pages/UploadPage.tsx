import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, RotateCcw } from 'lucide-react';
import { CVSelector } from '../components/CVSelector';
import { JobUrlInput, parseUrls, isValidUrl } from '../components/JobUrlInput';
import { BatchProgress } from '../components/BatchProgress';
import { JobCard } from '../components/JobCard';
import { ScrapeErrorCard } from '../components/ScrapeErrorCard';
import { SkillFilter } from '../components/SkillFilter';
import { scraperApi } from '../api/scraper';
import { normalizerApi } from '../api/normalizer';
import { matcherApi } from '../api/matcher';
import type { BatchState, JobPosting, MatchResult } from '../types';

const IDLE: BatchState = {
  step: 'idle',
  cvId: '',
  urls: [],
  scrapedCount: 0,
  skippedCount: 0,
  scrapeErrors: [],
  matchesFound: 0,
};

const SESSION_JOB_KEY = 'upload_job';

function loadJobFromSession(): BatchState {
  try {
    const raw = sessionStorage.getItem(SESSION_JOB_KEY);
    if (!raw) return IDLE;
    const parsed = JSON.parse(raw) as BatchState;
    // Only restore terminal states — never restore in-flight runs after a page reload
    if (parsed.step === 'done' || parsed.step === 'error') return parsed;
  } catch { /* ignore */ }
  return IDLE;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function matchesFilters(match: MatchResult, filters: string[]): boolean {
  if (filters.length === 0) return true;
  const all = [
    ...match.matched_skills,
    ...match.missing_skills,
    ...match.adjacent_skills,
  ].map((s) => s.toLowerCase());
  return filters.every((f) => all.some((s) => s.includes(f.toLowerCase())));
}

export function UploadPage() {
  const [selectedCvId, setSelectedCvId] = useState<string | null>(() =>
    sessionStorage.getItem('upload_cvId') ?? null
  );
  const [urlText, setUrlText] = useState(() =>
    sessionStorage.getItem('upload_urlText') ?? ''
  );
  // Restore job state from sessionStorage so results survive route navigation
  const [job, setJob] = useState<BatchState>(loadJobFromSession);
  const [skillFilters, setSkillFilters] = useState<string[]>([]);
  const abortRef = useRef(false);
  const queryClient = useQueryClient();

  // Persist CV selection
  useEffect(() => {
    if (selectedCvId) sessionStorage.setItem('upload_cvId', selectedCvId);
    else sessionStorage.removeItem('upload_cvId');
  }, [selectedCvId]);

  // Persist URL text
  useEffect(() => {
    sessionStorage.setItem('upload_urlText', urlText);
  }, [urlText]);

  // Persist job state — only terminal states; clear on idle
  useEffect(() => {
    if (job.step === 'idle') {
      sessionStorage.removeItem(SESSION_JOB_KEY);
    } else if (job.step === 'done' || job.step === 'error') {
      sessionStorage.setItem(SESSION_JOB_KEY, JSON.stringify(job));
    }
  }, [job]);

  // Postings are always fetched (used for joining with match results)
  const { data: postings = [] } = useQuery({
    queryKey: ['postings'],
    queryFn: () => scraperApi.listPostings(200),
    staleTime: 10_000,
  });

  // Match results — enabled whenever a job has been triggered (includes restored sessions)
  const jobTriggered = job.step !== 'idle';
  const { data: matches = [] } = useQuery({
    queryKey: ['matches', selectedCvId],
    queryFn: () => matcherApi.listMatches({ cvId: selectedCvId!, limit: 200 }),
    enabled: !!selectedCvId && jobTriggered,
    refetchInterval: () => {
      if (!selectedCvId) return false;
      return job.step === 'matching' || job.step === 'normalizing' ? 3000 : false;
    },
  });

  const postingMap = new Map<string, JobPosting>(postings.map((p) => [p.id, p]));

  // Restrict results to postings from the current (or restored) batch job
  const batchUrlSet = new Set(job.urls);
  const batchPostingIds = new Set(
    postings.filter((p) => batchUrlSet.has(p.url)).map((p) => p.id)
  );

  const results: Array<{ posting: JobPosting; match: MatchResult }> = matches
    .filter((m) => batchPostingIds.has(m.posting_id))
    .filter((m) => matchesFilters(m, skillFilters))
    .sort((a, b) => b.score - a.score)
    .flatMap((m) => {
      const posting = postingMap.get(m.posting_id);
      return posting ? [{ posting, match: m }] : [];
    });

  const runBatch = useCallback(async () => {
    if (!selectedCvId) return;
    const urls = parseUrls(urlText).filter((u) => {
      try { new URL(u); return true; } catch { return false; }
    });
    if (urls.length === 0) return;

    abortRef.current = false;
    setJob({ ...IDLE, step: 'scraping', cvId: selectedCvId, urls });

    // 1. Scrape
    let scrapeResult;
    try {
      scrapeResult = await scraperApi.scrape(urls);
    } catch (err) {
      setJob((j) => ({ ...j, step: 'error', errorMessage: String(err).replace(/^Error:\s*/i, '') }));
      return;
    }

    // Refresh postings via query cache so batchPostingIds picks up new entries
    const allPostings = await queryClient.fetchQuery({
      queryKey: ['postings'],
      queryFn: () => scraperApi.listPostings(200),
      staleTime: 0,
    });
    const batchUrlSet = new Set(urls);
    const batchIds = new Set(allPostings.filter((p) => batchUrlSet.has(p.url)).map((p) => p.id));

    setJob((j) => ({
      ...j,
      step: 'normalizing',
      scrapedCount: scrapeResult.scraped,
      skippedCount: scrapeResult.skipped,
      scrapeErrors: scrapeResult.errors,
    }));

    // 2. Normalize — skip if all batch postings are already normalized
    const batchPostings = allPostings.filter((p) => batchIds.has(p.id));
    const needsNormalization = batchPostings.some((p) => p.normalization_status !== 'done');

    if (needsNormalization) {
      try {
        await normalizerApi.processPending(50);
      } catch (err) {
        setJob((j) => ({ ...j, step: 'error', errorMessage: String(err).replace(/^Error:\s*/i, '') }));
        return;
      }

      // Poll until normalization finishes (max 3 min)
      for (let i = 0; i < 90; i++) {
        if (abortRef.current) return;
        await sleep(2000);
        try {
          const stats = await normalizerApi.getStats();
          if (stats.pending === 0 && stats.processing === 0) break;
        } catch { break; }
      }
    }

    if (abortRef.current) return;

    // Re-fetch postings to get updated normalization_status after the normalization step
    const postingsAfterNorm = await queryClient.fetchQuery({
      queryKey: ['postings'],
      queryFn: () => scraperApi.listPostings(200),
      staleTime: 0,
    });
    // Only postings that successfully normalized can be matched
    const normalizedBatchCount = postingsAfterNorm.filter(
      (p) => batchIds.has(p.id) && p.normalization_status === 'done'
    ).length;

    // 3. Match — skip if all normalized batch postings already have results for this CV
    const existingMatches = await queryClient.fetchQuery({
      queryKey: ['matches', selectedCvId],
      queryFn: () => matcherApi.listMatches({ cvId: selectedCvId, limit: 200 }),
      staleTime: 0,
    });
    const alreadyMatchedIds = new Set(existingMatches.map((m) => m.posting_id));
    const needsMatching = [...batchIds].some((id) => !alreadyMatchedIds.has(id));

    if (!needsMatching) {
      const matchCount = existingMatches.filter((m) => batchIds.has(m.posting_id)).length;
      setJob((j) => ({ ...j, step: 'done', matchesFound: matchCount }));
      return;
    }

    setJob((j) => ({ ...j, step: 'matching' }));

    try {
      await matcherApi.processPending();
    } catch (err) {
      setJob((j) => ({ ...j, step: 'error', errorMessage: String(err).replace(/^Error:\s*/i, '') }));
      return;
    }

    // Poll until all normalized batch postings have a match result (3 min max)
    for (let i = 0; i < 60; i++) {
      if (abortRef.current) return;
      await sleep(3000);
      try {
        const current = await queryClient.fetchQuery({
          queryKey: ['matches', selectedCvId],
          queryFn: () => matcherApi.listMatches({ cvId: selectedCvId, limit: 200 }),
          staleTime: 0,
        });
        const newCount = current.filter((m) => batchIds.has(m.posting_id)).length;
        setJob((j) => ({ ...j, matchesFound: newCount }));
        if (normalizedBatchCount > 0 && newCount >= normalizedBatchCount) break;
      } catch { break; }
    }

    setJob((j) => ({ ...j, step: 'done' }));
  }, [selectedCvId, urlText, queryClient]);

  const isRunning = job.step !== 'idle' && job.step !== 'done' && job.step !== 'error';

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      {/* Input section */}
      <div className="grid gap-4 md:grid-cols-2">
        <CVSelector
          selectedCvId={selectedCvId}
          onSelect={setSelectedCvId}
          onDeselect={() => setSelectedCvId(null)}
        />
        <JobUrlInput value={urlText} onChange={setUrlText} />
      </div>

      {/* Action button */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => { void runBatch(); }}
          disabled={isRunning || !selectedCvId || parseUrls(urlText).filter(isValidUrl).length === 0}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Play className="h-4 w-4" />
          Start Batch Job
        </button>
        {(job.step === 'done' || job.step === 'error') && (
          <button
            onClick={() => setJob(IDLE)}
            className="flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-400 hover:text-white transition-colors"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
        )}
      </div>

      {/* Progress */}
      {job.step !== 'idle' && <BatchProgress job={job} />}

      {/* Results — shown after any triggered job (including restored from session) */}
      {selectedCvId && jobTriggered && job.step !== 'error' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-300">
              Results
              {(matches.length > 0 || job.scrapeErrors.length > 0) && (
                <span className="ml-2 text-slate-500">
                  ({results.length} matched
                  {job.scrapeErrors.length > 0 && `, ${job.scrapeErrors.length} failed`})
                </span>
              )}
            </h2>
          </div>

          {matches.length > 0 && (
            <SkillFilter
              activeFilters={skillFilters}
              onAdd={(s) => setSkillFilters((f) => [...f, s])}
              onRemove={(s) => setSkillFilters((f) => f.filter((x) => x !== s))}
            />
          )}

          {results.length === 0 && matches.length > 0 && (
            <p className="text-sm text-slate-600 text-center py-4">
              No results match the current skill filters.
            </p>
          )}

          <div className="space-y-3">
            {results.map(({ posting, match }) => (
              <JobCard key={posting.id} posting={posting} match={match} />
            ))}
            {job.scrapeErrors.map((e) => (
              <ScrapeErrorCard key={e.url} url={e.url} error={e.error} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
