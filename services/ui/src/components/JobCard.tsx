import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronDown, ChevronUp, ExternalLink, MapPin, Briefcase, User, Mail, Phone, Building2,
} from 'lucide-react';
import { scraperApi } from '../api/scraper';
import { SkillBadge } from './SkillBadge';
import type { JobPosting, MatchResult } from '../types';

interface Props {
  posting: JobPosting;
  match: MatchResult;
}

function ScoreRing({ score }: { score: number }) {
  const color =
    score >= 80 ? 'bg-emerald-500' :
    score >= 66 ? 'bg-blue-500' :
    score >= 41 ? 'bg-amber-500' :
    'bg-red-500';

  return (
    <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${color} text-white`}>
      <span className="text-sm font-bold">{score}</span>
    </div>
  );
}

export function JobCard({ posting, match }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showNormalized, setShowNormalized] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const { data: fullPosting } = useQuery({
    queryKey: ['posting', posting.id],
    queryFn: () => scraperApi.getPosting(posting.id),
    enabled: showNormalized || showDetails,
    staleTime: Infinity,
  });

  const scoreColor =
    match.score >= 80 ? 'border-emerald-800/50 bg-emerald-950/20' :
    match.score >= 66 ? 'border-blue-800/50 bg-blue-950/20' :
    match.score >= 41 ? 'border-amber-800/50 bg-amber-950/20' :
    'border-red-800/50 bg-red-950/20';

  return (
    <div className={`rounded-lg border ${scoreColor} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-start gap-4 p-4">
        <ScoreRing score={match.score} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <a
              href={posting.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-base font-semibold text-white hover:text-indigo-300 flex items-center gap-1 group"
            >
              {posting.title}
              <ExternalLink className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
            </a>
            <button
              onClick={() => setExpanded(!expanded)}
              className="shrink-0 text-slate-500 hover:text-white transition-colors"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <Building2 className="h-3 w-3" /> {posting.company}
            </span>
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" /> {posting.location}
            </span>
            {posting.contract_type && (
              <span className="flex items-center gap-1">
                <Briefcase className="h-3 w-3" /> {posting.contract_type}
              </span>
            )}
            {posting.posted_at && (
              <span className="text-slate-600">{posting.posted_at.slice(0, 10)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Summary */}
      {match.summary && (
        <div className="px-4 pb-3">
          <p className="text-xs text-slate-400 leading-relaxed italic">{match.summary}</p>
        </div>
      )}

      {/* Skills (always visible) */}
      <div className="border-t border-slate-800 px-4 py-3 space-y-2">
        {match.matched_skills.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-emerald-500 font-medium w-16 shrink-0">Matched</span>
            {match.matched_skills.map((s) => (
              <SkillBadge key={s} skill={s} variant="matched" />
            ))}
          </div>
        )}
        {match.missing_skills.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-red-400 font-medium w-16 shrink-0">Missing</span>
            {match.missing_skills.map((s) => (
              <SkillBadge key={s} skill={s} variant="missing" />
            ))}
          </div>
        )}
        {match.adjacent_skills.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-amber-400 font-medium w-16 shrink-0">Adjacent</span>
            {match.adjacent_skills.map((s) => (
              <SkillBadge key={s} skill={s} variant="adjacent" />
            ))}
          </div>
        )}
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className="border-t border-slate-800">
          {/* Author info */}
          {(posting.author || posting.author_email || posting.author_tel || posting.author_company) && (
            <div className="px-4 py-3 flex flex-wrap gap-4 text-xs text-slate-400 border-b border-slate-800">
              {posting.author && (
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" /> {posting.author}
                </span>
              )}
              {posting.author_company && (
                <span className="flex items-center gap-1">
                  <Building2 className="h-3 w-3" /> {posting.author_company}
                </span>
              )}
              {posting.author_email && (
                <a href={`mailto:${posting.author_email}`} className="flex items-center gap-1 hover:text-indigo-300">
                  <Mail className="h-3 w-3" /> {posting.author_email}
                </a>
              )}
              {posting.author_tel && (
                <span className="flex items-center gap-1">
                  <Phone className="h-3 w-3" /> {posting.author_tel}
                </span>
              )}
            </div>
          )}

          {/* Normalized description toggle */}
          <div className="px-4 py-2 border-b border-slate-800">
            <button
              onClick={() => setShowNormalized(!showNormalized)}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
            >
              {showNormalized ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Normalized Description
            </button>
            {showNormalized && (
              <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-300 font-mono leading-relaxed">
                {fullPosting?.normalized_text ?? 'Loading…'}
              </pre>
            )}
          </div>

          {/* Full posting details toggle */}
          <div className="px-4 py-2">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
            >
              {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Scraped Details
            </button>
            {showDetails && (
              <div className="mt-2 space-y-2 text-xs text-slate-400">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <span className="text-slate-600">Source</span>
                  <span>{posting.source}</span>
                  <span className="text-slate-600">Scraped</span>
                  <span>{posting.scraped_at?.slice(0, 16).replace('T', ' ')}</span>
                  {posting.posted_at && (
                    <>
                      <span className="text-slate-600">Posted</span>
                      <span>{posting.posted_at}</span>
                    </>
                  )}
                  <span className="text-slate-600">Model</span>
                  <span className="font-mono">{match.model}</span>
                </div>
                {fullPosting?.description && (
                  <div>
                    <p className="text-slate-600 mb-1">Raw Description</p>
                    <p className="text-slate-500 leading-relaxed line-clamp-6">
                      {fullPosting.description}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
