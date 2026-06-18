// src/app/Skeleton.tsx
// Shared loading placeholders. Replacing plain "Loading…" text with shaped skeletons
// is the cheapest real win for perceived speed on client-fetched pages — the actual
// network/DB latency doesn't change, but a content-shaped placeholder reads as faster
// than a blank screen + spinner, and avoids the layout jump when real data arrives.

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <table className="table">
      <tbody>
        {Array.from({ length: rows }).map((_, r) => (
          <tr key={r}>
            {Array.from({ length: cols }).map((_, c) => (
              <td key={c}>
                <div className="skeleton-bar" style={{ width: c === 0 ? "70%" : "50%" }} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton-bar" style={{ width: i === lines - 1 ? "40%" : "90%", marginBottom: 8 }} />
      ))}
    </div>
  );
}
