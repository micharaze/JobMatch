import { useState } from 'react';
import { AlertCircle, Mail } from 'lucide-react';
import { parseEmlUrls } from '../utils/emlParser';

interface Props {
  value: string;
  onChange: (v: string) => void;
}

const DISPLAY_HOSTS = ['freelancermap.com', 'gulp.de', 'xing.com', 'solcom.de'];

function parseUrls(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export function isValidUrl(s: string): boolean {
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

  const [importMsg, setImportMsg] = useState<string | null>(null);

  function handleEmlFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text !== 'string') return;
      const extracted = parseEmlUrls(text);
      const existing = new Set(parseUrls(value));
      const fresh = extracted.filter((u) => !existing.has(u));
      if (fresh.length > 0) {
        onChange(value ? value.trimEnd() + '\n' + fresh.join('\n') : fresh.join('\n'));
        setImportMsg(`${fresh.length} URL${fresh.length !== 1 ? 's' : ''} imported`);
      } else if (extracted.length > 0) {
        setImportMsg('All URLs already present');
      } else {
        setImportMsg('No supported job URLs found in email');
      }
      setTimeout(() => setImportMsg(null), 4000);
      // Reset input so the same file can be re-selected
      e.target.value = '';
    };
    reader.readAsText(file);
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-slate-300">2. Job Post URLs</h2>
        <div className="flex items-center gap-2">
          {lines.length > 0 && (
            <span className="text-xs text-slate-500">{lines.length} URL{lines.length !== 1 ? 's' : ''}</span>
          )}
          {/* label htmlFor is the reliable cross-browser way to activate a file input */}
          <label
            htmlFor="eml-import-input"
            className="flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
            title="Import URLs from .eml file"
          >
            <Mail className="h-3 w-3" />
            Import .eml
          </label>
          <input
            id="eml-import-input"
            type="file"
            accept=".eml"
            className="hidden"
            onChange={handleEmlFile}
          />
        </div>
      </div>

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Paste job URLs — one per line\nhttps://www.freelancermap.com/...\nhttps://www.gulp.de/...`}
        rows={6}
        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 resize-y focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
      />

      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-slate-600">
          Supported: {DISPLAY_HOSTS.join(', ')}
        </p>
        {importMsg && (
          <p className="text-xs text-emerald-400">{importMsg}</p>
        )}
      </div>

      {invalid.length > 0 && (
        <p className="mt-1 flex items-center gap-1 text-xs text-red-400">
          <AlertCircle className="h-3 w-3" />
          {invalid.length} invalid URL{invalid.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}

export { parseUrls };
