interface Props {
  verdict: 'good' | 'warn' | 'bad' | undefined;
}

const VERDICT_MAP = {
  good: { label: 'Good', className: 'quality-good' },
  warn: { label: 'Warning', className: 'quality-warn' },
  bad: { label: 'Poor', className: 'quality-bad' },
} as const;

export function QualityBadge({ verdict }: Props) {
  if (!verdict) return null;
  const { label, className } = VERDICT_MAP[verdict] ?? VERDICT_MAP.good;
  return (
    <span
      className={`inline-block text-xs font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ml-2 align-middle ${className}`}
    >
      {label}
    </span>
  );
}
