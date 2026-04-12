import { useState, Fragment } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { scraperApi } from '../api/scraper';
import { matcherApi } from '../api/matcher';
import { SkillBadge } from '../components/SkillBadge';
import type { JobPosting, MatchResult } from '../types';

interface Row {
  posting: JobPosting;
  bestScore: number | null;
  match: MatchResult | null;
}

function ScoreCell({ score }: { score: number | null }) {
  if (score === null) return <span className="text-slate-600">—</span>;
  const color =
    score >= 80 ? 'text-emerald-400' :
    score >= 66 ? 'text-blue-400' :
    score >= 41 ? 'text-amber-400' :
    'text-red-400';
  return <span className={`font-bold ${color}`}>{score}</span>;
}

export function ArchivePage() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const queryClient = useQueryClient();

  const { data: postings = [] } = useQuery({
    queryKey: ['postings'],
    queryFn: () => scraperApi.listPostings(200),
    staleTime: 10_000,
  });

  const { data: allMatches = [] } = useQuery({
    queryKey: ['matches', null],
    queryFn: () => matcherApi.listMatches({ limit: 1000 }),
    staleTime: 10_000,
  });

  // Build best-score map per posting
  const bestScores = new Map<string, MatchResult>();
  for (const m of allMatches) {
    const existing = bestScores.get(m.posting_id);
    if (!existing || m.score > existing.score) {
      bestScores.set(m.posting_id, m);
    }
  }

  const rows: Row[] = postings.map((posting) => {
    const match = bestScores.get(posting.id) ?? null;
    return { posting, bestScore: match?.score ?? null, match };
  }).sort((a, b) => (b.bestScore ?? -1) - (a.bestScore ?? -1));

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.posting.id)));
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    setDeleting(true);
    try {
      const urlsToDelete = rows
        .filter((r) => selected.has(r.posting.id))
        .map((r) => r.posting.url);
      await scraperApi.deletePostings(urlsToDelete);
      setSelected(new Set());
      await queryClient.invalidateQueries({ queryKey: ['postings'] });
      await queryClient.invalidateQueries({ queryKey: ['matches'] });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-white">Archive</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">{postings.length} posting{postings.length !== 1 ? 's' : ''}</span>
          {selected.size > 0 && (
            <button
              onClick={() => { void deleteSelected(); }}
              disabled={deleting}
              className="flex items-center gap-1.5 rounded-md bg-red-900/60 border border-red-700/50 px-3 py-1.5 text-xs text-red-300 hover:bg-red-800/60 transition-colors disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete {selected.size} selected
            </button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-16 text-slate-600">
          No job postings scraped yet.
        </div>
      ) : (
        <div className="rounded-lg border border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900">
                <th className="w-8 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={selected.size === rows.length && rows.length > 0}
                    onChange={toggleAll}
                    className="accent-indigo-500"
                  />
                </th>
                <th className="px-3 py-3 text-left font-medium text-slate-400">Score</th>
                <th className="px-3 py-3 text-left font-medium text-slate-400">Title</th>
                <th className="px-3 py-3 text-left font-medium text-slate-400 hidden md:table-cell">Company</th>
                <th className="px-3 py-3 text-left font-medium text-slate-400 hidden lg:table-cell">Location</th>
                <th className="px-3 py-3 text-left font-medium text-slate-400 hidden lg:table-cell">Scraped</th>
                <th className="w-8 px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ posting, bestScore, match }) => {
                const isExpanded = expandedId === posting.id;
                return (
                  <Fragment key={posting.id}>
                    <tr
                      className={`border-b border-slate-800/50 transition-colors ${
                        selected.has(posting.id) ? 'bg-slate-800/30' : 'hover:bg-slate-900/50'
                      }`}
                    >
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(posting.id)}
                          onChange={() => toggleSelect(posting.id)}
                          className="accent-indigo-500"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <ScoreCell score={bestScore} />
                      </td>
                      <td className="px-3 py-3 max-w-xs">
                        <a
                          href={posting.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-white hover:text-indigo-300 group truncate"
                        >
                          <span className="truncate">{posting.title}</span>
                          <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100" />
                        </a>
                      </td>
                      <td className="px-3 py-3 text-slate-400 hidden md:table-cell">{posting.company}</td>
                      <td className="px-3 py-3 text-slate-500 hidden lg:table-cell">{posting.location}</td>
                      <td className="px-3 py-3 text-slate-600 hidden lg:table-cell text-xs">
                        {posting.scraped_at?.slice(0, 10)}
                      </td>
                      <td className="px-3 py-3">
                        {match && (
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : posting.id)}
                            className="text-slate-600 hover:text-white transition-colors"
                          >
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </button>
                        )}
                      </td>
                    </tr>
                    {isExpanded && match && (
                      <tr className="border-b border-slate-800/50 bg-slate-900/30">
                        <td colSpan={7} className="px-6 py-4">
                          <p className="text-xs text-slate-400 mb-3 italic">{match.summary}</p>
                          <div className="space-y-2">
                            {match.matched_skills.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-xs text-emerald-500 w-14">Matched</span>
                                {match.matched_skills.map((s) => (
                                  <SkillBadge key={s} skill={s} variant="matched" />
                                ))}
                              </div>
                            )}
                            {match.missing_skills.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-xs text-red-400 w-14">Missing</span>
                                {match.missing_skills.map((s) => (
                                  <SkillBadge key={s} skill={s} variant="missing" />
                                ))}
                              </div>
                            )}
                            {match.adjacent_skills.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-xs text-amber-400 w-14">Adjacent</span>
                                {match.adjacent_skills.map((s) => (
                                  <SkillBadge key={s} skill={s} variant="adjacent" />
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
