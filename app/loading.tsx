export default function Loading() {
  return (
    <div className="space-y-7" aria-label="Loading dashboard">
      <div className="animate-pulse space-y-3">
        <div className="h-7 w-48 rounded bg-[var(--surface-muted)]" />
        <div className="h-4 w-72 max-w-full rounded bg-[var(--surface-muted)]" />
      </div>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="surface animate-pulse rounded-2xl p-5">
            <div className="mb-5 h-10 w-10 rounded-xl bg-[var(--surface-muted)]" />
            <div className="mb-3 h-3 w-24 rounded bg-[var(--surface-muted)]" />
            <div className="h-7 w-16 rounded bg-[var(--surface-muted)]" />
          </div>
        ))}
      </div>
      <div className="surface h-72 animate-pulse rounded-2xl" />
    </div>
  );
}
