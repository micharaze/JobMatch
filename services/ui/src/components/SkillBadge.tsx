interface Props {
  skill: string;
  variant: 'matched' | 'missing' | 'adjacent';
}

export function SkillBadge({ skill, variant }: Props) {
  const styles = {
    matched: 'bg-emerald-900/50 text-emerald-300 border border-emerald-700/50',
    missing: 'bg-red-900/50 text-red-300 border border-red-700/50',
    adjacent: 'bg-amber-900/50 text-amber-300 border border-amber-700/50',
  };

  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${styles[variant]}`}>
      {skill}
    </span>
  );
}
