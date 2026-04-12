import { AlertCircle } from 'lucide-react';

interface Props {
  value: string;
  onChange: (v: string) => void;
}

const DISPLAY_HOSTS = ['freelancermap.com', 'gulp.de', 'xing.com'];
const ACCEPTED_DOMAINS = ['freelancermap.com', 'freelancermap.de', 'gulp.de', 'xing.com'];

function parseUrls(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function isValidUrl(s: string): boolean {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

export function JobUrlInput({ value, onChange }: Props) {
  const lines = parseUrls(value);
  const invalid = lines.filter((l) => !isValidUrl(l));
  const unsupported = lines.filter((l) => {
    if (!isValidUrl(l)) return false;
    const host = new URL(l).hostname.replace(/^www\./, '');
    return !ACCEPTED_DOMAINS.some((h) => host.endsWith(h));
  });

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-slate-300">2. Job Post URLs</h2>
        {lines.length > 0 && (
          <span className="text-xs text-slate-500">{lines.length} URL{lines.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Paste job URLs — one per line\nhttps://www.freelancermap.com/...\nhttps://www.gulp.de/...`}
        rows={6}
        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 resize-y focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
      />

      <p className="mt-2 text-xs text-slate-600">
        Supported: {DISPLAY_HOSTS.join(', ')}
      </p>

      {invalid.length > 0 && (
        <p className="mt-1 flex items-center gap-1 text-xs text-red-400">
          <AlertCircle className="h-3 w-3" />
          {invalid.length} invalid URL{invalid.length !== 1 ? 's' : ''}
        </p>
      )}
      {unsupported.length > 0 && invalid.length === 0 && (
        <p className="mt-1 flex items-center gap-1 text-xs text-amber-400">
          <AlertCircle className="h-3 w-3" />
          {unsupported.length} unsupported source{unsupported.length !== 1 ? 's' : ''} (will fail)
        </p>
      )}
    </div>
  );
}

export { parseUrls };
