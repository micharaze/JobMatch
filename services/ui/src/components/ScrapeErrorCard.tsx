import { AlertTriangle, ExternalLink } from 'lucide-react';

interface Props {
  url: string;
  error: string;
}

export function ScrapeErrorCard({ url, error }: Props) {
  let hostname = url;
  try { hostname = new URL(url).hostname; } catch { /* keep raw */ }

  return (
    <div className="rounded-lg border border-red-900/50 bg-red-950/20 overflow-hidden">
      <div className="flex items-start gap-4 p-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-900/40 text-red-400">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-red-300 hover:text-red-200 flex items-center gap-1 group truncate"
            >
              {hostname}
              <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
            </a>
          </div>
          <p className="mt-0.5 text-xs text-slate-500 truncate">{url}</p>
        </div>
      </div>
      <div className="border-t border-red-900/40 px-4 py-2">
        <p className="text-xs text-red-400">Scrape failed: {error}</p>
      </div>
    </div>
  );
}
