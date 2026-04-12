import { useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  activeFilters: string[];
  onAdd: (skill: string) => void;
  onRemove: (skill: string) => void;
}

export function SkillFilter({ activeFilters, onAdd, onRemove }: Props) {
  const [input, setInput] = useState('');

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === 'Enter' || e.key === ',') && input.trim()) {
      e.preventDefault();
      const skill = input.trim().replace(/,$/, '');
      if (skill && !activeFilters.includes(skill)) {
        onAdd(skill);
      }
      setInput('');
    }
    if (e.key === 'Backspace' && !input && activeFilters.length > 0) {
      onRemove(activeFilters[activeFilters.length - 1]!);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
      <span className="text-xs text-slate-500 shrink-0">Filter skills:</span>
      {activeFilters.map((skill) => (
        <span
          key={skill}
          className="flex items-center gap-1 rounded-full bg-indigo-900/60 border border-indigo-700/50 px-2 py-0.5 text-xs text-indigo-300"
        >
          {skill}
          <button onClick={() => onRemove(skill)} className="hover:text-white">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={activeFilters.length === 0 ? 'Type skill + Enter to filter…' : 'Add more…'}
        className="min-w-[140px] flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-600 outline-none"
      />
    </div>
  );
}
