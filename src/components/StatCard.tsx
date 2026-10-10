type StatCardProps = {
  label: string;
  value: string;
  detail?: string;
  accent?: 'green' | 'orange' | 'blue' | 'purple';
};

export function StatCard({ label, value, detail, accent = 'green' }: StatCardProps) {
  return (
    <article className={`analytics-stat analytics-stat-${accent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </article>
  );
}
