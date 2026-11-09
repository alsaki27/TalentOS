import type { CSSProperties } from 'react';
import {
  CSS_PX_PER_INCH, DEFAULT_LINE_SPACING, DEFAULT_PAGE_PADDING, getPageSizeCss, getPageSizePx, type ResumeData,
} from '@/components/falood/resumify/types/resume';

export interface ResumePageSlice {
  start: number;
  end: number;
}

export function getResumePageArea(data: Pick<ResumeData, 'pagePadding' | 'pageFormat'>) {
  const padding = Number.isFinite(data.pagePadding)
    ? Math.min(1.25, Math.max(0, data.pagePadding))
    : DEFAULT_PAGE_PADDING;
  const size = getPageSizePx(data.pageFormat);
  // Leave one CSS pixel for fractional rounding in the print engine.
  const usableHeight = Math.max(1, size.height - 2 * padding * CSS_PX_PER_INCH - 1);
  return { padding, size, usableHeight };
}

export function getResumePaperStyle(data: Pick<ResumeData, 'pagePadding' | 'pageFormat' | 'lineSpacing'>) {
  const { padding, size } = getResumePageArea(data);
  const css = getPageSizeCss(data.pageFormat);
  const lineSpacing = data.lineSpacing ?? DEFAULT_LINE_SPACING;
  return {
    '--resume-page-width': css.width,
    '--resume-page-height': css.height,
    '--resume-page-padding': padding + 'in',
    '--resume-content-width': Math.floor(size.width - 2 * padding * CSS_PX_PER_INCH) + 'px',
    '--resume-line-height': String(lineSpacing),
    lineHeight: lineSpacing,
    color: '#050505ff',
  } as CSSProperties;
}

export function getResumePageUtilizations(pages: ResumePageSlice[], usableHeight: number) {
  return pages.map(({ start, end }) => Math.min(1, Math.max(0, (end - start) / usableHeight)));
}

export function measureResumePages(content: HTMLElement, usableHeight: number): ResumePageSlice[] {
  const origin = content.getBoundingClientRect();
  const height = origin.height;
  if (height <= usableHeight) return [{ start: 0, end: height }];

  const protectedBands: ResumePageSlice[] = [];
  const range = content.ownerDocument.createRange();
  const walker = content.ownerDocument.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.textContent?.trim() || !node.parentElement) continue;
    range.selectNodeContents(node);
    const lineHeight = parseFloat(getComputedStyle(node.parentElement).lineHeight);
    for (const rect of Array.from(range.getClientRects())) {
      if (!rect.width || !rect.height) continue;
      // Range boxes describe the font, which can be taller than the line.
      // Keep the painted line together without joining all adjacent lines.
      const center = (rect.top + rect.bottom) / 2 - origin.top;
      const half = Math.min(rect.height, lineHeight || rect.height) / 2;
      protectedBands.push({ start: center - half + 0.25, end: center + half - 0.25 });
    }
  }
  for (const image of Array.from(content.querySelectorAll('img, svg'))) {
    const rect = image.getBoundingClientRect();
    if (rect.height > 0) {
      protectedBands.push({ start: rect.top - origin.top, end: rect.bottom - origin.top });
    }
  }

  return paginateResume(height, usableHeight, protectedBands);
}

export function paginateResume(layoutHeight: number, usableHeight: number, protectedBands: ResumePageSlice[]): ResumePageSlice[] {
  // Preserve trailing space where it fits, without letting an empty margin
  // create a new sheet.
  const lastVisibleLine = protectedBands.reduce((bottom, band) => Math.max(bottom, band.end), 0);
  const height = lastVisibleLine || layoutHeight;
  if (height <= usableHeight) {
    return [{ start: 0, end: Math.min(Math.max(height, layoutHeight), usableHeight) }];
  }
  const merged: ResumePageSlice[] = [];
  for (const band of [...protectedBands].sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && band.start < last.end) last.end = Math.max(last.end, band.end);
    else merged.push({ ...band });
  }

  const pages: ResumePageSlice[] = [];
  let start = 0;
  let bandIndex = 0;
  while (start < height) {
    const limit = Math.min(start + usableHeight, height);
    while (bandIndex < merged.length && merged[bandIndex].end <= limit) bandIndex++;
    const band = merged[bandIndex];
    const end = limit < height && band && band.start < limit && band.start > start + 1
      ? band.start
      : limit;
    pages.push({ start, end });
    start = end;
  }
  const lastPage = pages[pages.length - 1];
  lastPage.end = Math.max(lastPage.end, Math.min(layoutHeight, lastPage.start + usableHeight));
  return pages;
}

export async function printStudioResume(): Promise<boolean> {
  const area = document.getElementById('resume-print-area');
  if (!area) return false;
  await document.fonts.ready;
  await Promise.all(Array.from(area.querySelectorAll('img'), (image) => image.decode().catch(() => {})));
  // Give ResizeObserver and React time to commit the latest page plan.
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  if (!area.isConnected || !area.querySelector('.resume-sheet')) return false;
  window.print();
  return true;
}
