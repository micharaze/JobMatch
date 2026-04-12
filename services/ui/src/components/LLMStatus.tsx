import { useQuery } from '@tanstack/react-query';
import { normalizerApi } from '../api/normalizer';

const STATUS_LABELS: Record<string, string> = {
  loaded: 'Loaded',
  installed: 'Installed',
  not_installed: 'Not found',
  unreachable: 'Unreachable',
  ready: 'Ready',
  no_api_key: 'No API key',
};

export function LLMStatus() {
  const { data, isError } = useQuery({
    queryKey: ['llm-ping'],
    queryFn: () => normalizerApi.llmPing(),
    refetchInterval: 30_000,
    retry: 1,
    staleTime: 20_000,
  });

  if (isError || !data) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
        <span>LLM unknown</span>
      </div>
    );
  }

  const dotColor =
    data.status === 'loaded' || data.status === 'ready'
      ? 'bg-emerald-400'
      : data.status === 'installed'
        ? 'bg-amber-400'
        : 'bg-red-500';

  const providerLabel = data.provider === 'gemini' ? 'Gemini' : 'Ollama';

  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-300">
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      <span className="font-mono">{data.model}</span>
      <span className="text-slate-500">·</span>
      <span>{providerLabel}</span>
      <span className="text-slate-600">·</span>
      <span className={`${data.ok ? 'text-slate-400' : 'text-red-400'}`}>
        {STATUS_LABELS[data.status] ?? data.status}
      </span>
    </div>
  );
}
