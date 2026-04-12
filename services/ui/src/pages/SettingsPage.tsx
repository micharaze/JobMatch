import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Save, Info, Eye, EyeOff } from 'lucide-react';
import { normalizerApi } from '../api/normalizer';
import { LLMStatus } from '../components/LLMStatus';
import type { Settings } from '../types';
import { DEFAULT_SETTINGS } from '../types';

const STORAGE_KEY = 'jobmatch_settings';

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as Settings;
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(s: Settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

const GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-2.5-pro',
];

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [saved, setSaved] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  const { data: activeConfig } = useQuery({
    queryKey: ['llm-status'],
    queryFn: () => normalizerApi.getLLMStatus(),
    staleTime: 30_000,
  });

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  // Reset saved indicator when settings change
  useEffect(() => { setSaved(false); }, [settings]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      <h1 className="text-lg font-semibold text-white">Settings</h1>

      {/* Active configuration */}
      <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Active Configuration</h2>
        {activeConfig ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span className="text-slate-500">Provider</span>
            <span className="text-slate-200 capitalize">{activeConfig.provider}</span>
            <span className="text-slate-500">Model</span>
            <span className="text-slate-200 font-mono">{activeConfig.model}</span>
            <span className="text-slate-500">API Key</span>
            <span className={activeConfig.hasApiKey ? 'text-emerald-400' : 'text-red-400'}>
              {activeConfig.hasApiKey ? 'Set' : 'Not set'}
            </span>
          </div>
        ) : (
          <p className="text-xs text-slate-600">Loading…</p>
        )}
        <div className="pt-1">
          <p className="text-xs text-slate-500 mb-1">Current LLM status:</p>
          <LLMStatus />
        </div>
      </div>

      {/* LLM Provider toggle */}
      <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 space-y-4">
        <h2 className="text-sm font-medium text-slate-300">LLM Provider</h2>
        <div className="flex gap-2">
          {(['ollama', 'gemini'] as const).map((p) => (
            <button
              key={p}
              onClick={() => set('provider', p)}
              className={`rounded-md px-4 py-2 text-sm transition-colors ${
                settings.provider === p
                  ? 'bg-indigo-600 text-white'
                  : 'border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500'
              }`}
            >
              {p === 'ollama' ? 'Ollama (local)' : 'Gemini API'}
            </button>
          ))}
        </div>

        {/* Ollama settings */}
        {settings.provider === 'ollama' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Ollama Base URL</label>
              <input
                type="text"
                value={settings.ollamaBaseUrl}
                onChange={(e) => set('ollamaBaseUrl', e.target.value)}
                placeholder="http://localhost:11434"
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Model Name</label>
              <input
                type="text"
                value={settings.ollamaModel}
                onChange={(e) => set('ollamaModel', e.target.value)}
                placeholder="gemma4:e4b"
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
              />
            </div>
          </div>
        )}

        {/* Gemini settings */}
        {settings.provider === 'gemini' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Gemini API Key</label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={settings.geminiApiKey}
                  onChange={(e) => set('geminiApiKey', e.target.value)}
                  placeholder="AIza…"
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 pr-9 text-sm text-slate-200 placeholder-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Model</label>
              <select
                value={settings.geminiModel}
                onChange={(e) => set('geminiModel', e.target.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {GEMINI_MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors ${
            saved
              ? 'bg-emerald-600 text-white'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white'
          }`}
        >
          <Save className="h-4 w-4" />
          {saved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>

      {/* Note */}
      <div className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
        <Info className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" />
        <p className="text-xs text-slate-500 leading-relaxed">
          Settings saved here are stored locally in your browser. The active LLM configuration shown above is
          set via environment variables in your <code className="font-mono text-slate-400">.env</code> file.
          To apply different settings, update <code className="font-mono text-slate-400">LLM_PROVIDER</code>,{' '}
          <code className="font-mono text-slate-400">GEMMA_MODEL</code>, and{' '}
          <code className="font-mono text-slate-400">GEMINI_API_KEY</code> in your{' '}
          <code className="font-mono text-slate-400">.env</code> and restart the Docker services.
        </p>
      </div>
    </div>
  );
}
