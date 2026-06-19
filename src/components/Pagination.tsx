"use client";

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export default function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  function getPageNumbers(): (number | string)[] {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (page <= 4) {
        for (let i = 1; i <= 5; i++) pages.push(i);
        pages.push("...");
        pages.push(totalPages);
      } else if (page >= totalPages - 3) {
        pages.push(1);
        pages.push("...");
        for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i);
      } else {
        pages.push(1);
        pages.push("...");
        for (let i = page - 1; i <= page + 1; i++) pages.push(i);
        pages.push("...");
        pages.push(totalPages);
      }
    }
    return pages;
  }

  return (
    <div className="pagination-bar" style={{ justifyContent: "space-between" }}>
      <span className="muted" style={{ fontSize: 13 }}>
        Showing {from}–{to} of {total}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          style={{ fontSize: 13, padding: "6px 12px" }}
        >
          Previous
        </button>
        {getPageNumbers().map((p, i) =>
          p === "..." ? (
            <span
              key={`ellipsis-${i}`}
              className="muted"
              style={{ padding: "0 4px", fontSize: 13 }}
            >
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p as number)}
              className={page === p ? "btn-primary" : ""}
              style={{ minWidth: 34, padding: "6px 10px", fontSize: 13 }}
            >
              {p}
            </button>
          )
        )}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          style={{ fontSize: 13, padding: "6px 12px" }}
        >
          Next
        </button>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          style={{ width: "auto", minWidth: 90, fontSize: 13 }}
        >
          <option value={25}>25 / page</option>
          <option value={50}>50 / page</option>
          <option value={100}>100 / page</option>
        </select>
      </div>
    </div>
  );
}
