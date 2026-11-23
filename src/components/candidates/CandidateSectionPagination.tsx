"use client";

import { useEffect, useId, useState } from "react";
import styles from "./CandidateSectionPagination.module.css";

export function CandidateSectionPagination({ page, pageSize, total, label, onPageChange, onPageSizeChange, pageSizeOptions = [6, 12, 24] }: {
  page: number;
  pageSize: number;
  total: number;
  label: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
}) {
  const id = useId();
  const [pageInput, setPageInput] = useState("");
  const [pageError, setPageError] = useState("");
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  useEffect(() => { setPageInput(""); setPageError(""); }, [current, pages, pageSize]);
  if (!total) return null;

  const numbers: Array<number | string> = pages <= 7
    ? Array.from({ length: pages }, (_, index) => index + 1)
    : current <= 4 ? [1, 2, 3, 4, 5, "...", pages]
      : current >= pages - 3 ? [1, "...", pages - 4, pages - 3, pages - 2, pages - 1, pages]
        : [1, "...", current - 1, current, current + 1, "...", pages];

  function goToPage() {
    const target = Number(pageInput);
    if (!/^\d+$/.test(pageInput) || !Number.isSafeInteger(target) || target < 1) {
      setPageError("Enter a valid page number");
      return;
    }
    if (target > pages) {
      setPageError(`Page must be 1–${pages}`);
      return;
    }
    setPageError("");
    setPageInput("");
    onPageChange(target);
  }

  return <nav className={styles.pagination} aria-label={`${label} pagination`}>
    <div className={styles.controls}>
      <div className={styles.numbers}>
        <button type="button" aria-label={`Previous ${label.toLowerCase()} page`} disabled={current === 1} onClick={() => onPageChange(current - 1)}>Prev</button>
        {numbers.map((number, index) => typeof number === "number" ?
          <button key={number} type="button" className={number === current ? "btn-primary" : undefined}
            aria-label={`${label} page ${number}`} aria-current={number === current ? "page" : undefined}
            onClick={() => number !== current && onPageChange(number)}>{number}</button> :
          <span key={`ellipsis-${index}`} className={styles.ellipsis}>…</span>)}
        <button type="button" aria-label={`Next ${label.toLowerCase()} page`} disabled={current === pages} onClick={() => onPageChange(current + 1)}>Next</button>
      </div>
      <div className={styles.jump}>
        <label htmlFor={`${id}-page`}>Page</label>
        <input id={`${id}-page`} type="number" min={1} max={pages} step={1} value={pageInput} placeholder={`1–${pages}`}
          aria-label={`${label} page number`} aria-invalid={Boolean(pageError)} aria-describedby={pageError ? `${id}-error` : undefined}
          onChange={(event) => { setPageInput(event.target.value); setPageError(""); }}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); goToPage(); } }} />
        <button type="button" onClick={goToPage}>Go</button>
      </div>
    </div>
    {pageError && <p id={`${id}-error`} className={styles.error} role="alert">{pageError}</p>}
    <div className={styles.footer}>
      <span className={styles.count} aria-live="polite">{(current - 1) * pageSize + 1}–{Math.min(current * pageSize, total)} of {total} {label.toLowerCase()}</span>
      {pageSizeOptions.length > 1 && <label className={styles.pageSize} htmlFor={`${id}-size`}>Per page
        <select id={`${id}-size`} aria-label="Per page" value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
          {pageSizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>}
    </div>
  </nav>;
}
