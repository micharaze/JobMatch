import { Check, Loader2 } from 'lucide-react';
import type { BatchState } from '../types';

interface Props {
  job: BatchState;
}

const STEPS = [
  { id: 'scraping',    label: 'Scraping' },
  { id: 'normalizing', label: 'Normalizing' },
  { id: 'matching',    label: 'Matching' },
  { id: 'done',        label: 'Done' },
] as const;

type StepId = (typeof STEPS)[number]['id'];

function stepIndex(step: string): number {
  const ids: string[] = ['idle', 'scraping', 'normalizing', 'matching', 'done', 'error'];
  return ids.indexOf(step);
}

function stepDetail(job: BatchState, id: StepId): string {
  switch (id) {
    case 'scraping':
      return `${job.scrapedCount} scraped · ${job.skippedCount} skipped${
        job.scrapeErrors.length ? ` · ${job.scrapeErrors.length} errors` : ''
      }`;
    case 'normalizing':
      return 'Compressing descriptions with LLM…';
    case 'matching':
      return job.matchesFound > 0
        ? `${job.matchesFound} match${job.matchesFound !== 1 ? 'es' : ''} found so far…`
        : 'Running LLM scoring…';
    case 'done':
      return `${job.matchesFound} match${job.matchesFound !== 1 ? 'es' : ''} found`;
  }
}

export function BatchProgress({ job }: Props) {
  const current = stepIndex(job.step);

  if (job.step === 'error') {
    return (
      <div className="rounded-lg border border-red-800 bg-red-950/30 p-4">
        <p className="text-sm font-medium text-red-400">Batch job failed</p>
        {job.errorMessage && (
          <p className="mt-1 text-xs text-red-500">{job.errorMessage}</p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
      <p className="mb-4 text-xs font-medium uppercase tracking-wider text-slate-500">
        Batch Job Running
      </p>
      <div className="space-y-3">
        {STEPS.map((step, i) => {
          const idx = i + 1; // step index (scraping=1, normalizing=2, etc.)
          const done = current > idx;
          const active = job.step === step.id;
          const pending = current < idx;

          return (
            <div key={step.id} className="flex items-start gap-3">
              <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                active && step.id !== 'done'
                  ? 'bg-indigo-600 text-white'
                  : done || (active && step.id === 'done')
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800 text-slate-600'
              }`}>
                {done || (active && step.id === 'done') ? (
                  <Check className="h-3 w-3" />
                ) : active ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <span>{i + 1}</span>
                )}
              </div>
              <div>
                <p className={`text-sm font-medium ${
                  active ? 'text-white' : done ? 'text-emerald-400' : pending ? 'text-slate-600' : 'text-slate-400'
                }`}>
                  {step.label}
                </p>
                {(active || done) && (
                  <p className="text-xs text-slate-500 mt-0.5">{stepDetail(job, step.id)}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {job.scrapeErrors.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-red-400">
            {job.scrapeErrors.length} scrape error{job.scrapeErrors.length !== 1 ? 's' : ''}
          </summary>
          <ul className="mt-2 space-y-1">
            {job.scrapeErrors.map((e) => (
              <li key={e.url} className="text-xs text-slate-500">
                <span className="text-red-500">{e.error}</span> — {e.url}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
