import React, { useMemo, useLayoutEffect } from 'react';
import { useResume } from '@/components/falood/resumify/contexts/ResumeContext';
import {
  DEFAULT_PAGE_PADDING,
  getPageSizePx,
  getPageSizeCss,
  PAGE_OVERFLOW_TOLERANCE_PX,
} from '@/components/falood/resumify/types/resume';
import { ResumeTemplateSwitch } from './ResumeTemplateSwitch';
import { applySuggestionToResumeData } from './AiSuggestions';
import { Skeleton } from '@/components/ui/skeleton';

export const ResumePreview: React.FC = () => {
  const { state } = useResume();
  const { resumeData, previewSuggestion } = state;
  const previewData = useMemo(() => {
    if (previewSuggestion) {
      return applySuggestionToResumeData(resumeData, previewSuggestion);
    }
    return resumeData;
  }, [resumeData, previewSuggestion]);

  const pagePadding = previewData.pagePadding ?? DEFAULT_PAGE_PADDING;

  const renderTemplate = () => <ResumeTemplateSwitch data={previewData} />;

  const [containerRef, setContainerRef] = React.useState<HTMLDivElement | null>(null);
  const [scale, setScale] = React.useState(0.8);
  const [dimensions, setDimensions] = React.useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (!containerRef) return;
    
    const suggestionsToHighlight: any[] = [];

    // Only include currently hovered preview suggestion
    if (previewSuggestion) {
        suggestionsToHighlight.push(previewSuggestion);
    }

    const appliedElements = new Map<HTMLElement, string[]>();

    suggestionsToHighlight.forEach(suggestion => {
        const searchStrings: string[] = [];
        
        // For accepted suggestions, search for the SUGGESTED (new) text
        // For rejected/pending, search for the ORIGINAL text
        const isAccepted = suggestion.status === 'accepted';
        const targetTextSource = isAccepted ? suggestion.suggested : (suggestion.original || suggestion.suggested);
        
        if (!targetTextSource) return;

        if (suggestion.type === 'experience' && typeof targetTextSource === 'string') {
            searchStrings.push(targetTextSource);
        } else if (suggestion.type === 'summary' && typeof targetTextSource === 'string') {
            searchStrings.push(targetTextSource);
        } else if (suggestion.type === 'personal_info' && typeof targetTextSource === 'string') {
            searchStrings.push(targetTextSource);
        } else if ((suggestion.type === 'skill' || suggestion.type === 'skill_remove') && Array.isArray(targetTextSource)) {
            searchStrings.push(...targetTextSource);
        } else if (suggestion.type === 'skill_reorg' && Array.isArray(targetTextSource)) {
            targetTextSource.forEach((cat: any) => {
                if (cat && Array.isArray(cat.skills)) {
                    searchStrings.push(...cat.skills);
                }
            });
        }

        const cleanSearchStrings = searchStrings
            .filter(s => typeof s === 'string' && s.trim().length > 2)
            .map(s => s.replace(/\s+/g, ' ').trim().toLowerCase());

        if (cleanSearchStrings.length === 0) return;

        const walk = document.createTreeWalker(containerRef, NodeFilter.SHOW_TEXT, null);
        let node;
        while ((node = walk.nextNode())) {
            const text = (node.nodeValue || '').replace(/\s+/g, ' ').trim().toLowerCase();
            // Match if the text node contains the search string, OR if the text node is a significant chunk (>20 chars) of the search string.
            // This prevents highlighting small irrelevant words (like "and", "the", dates) that happen to be substrings of the suggestion.
            if (text && cleanSearchStrings.some(s => text.includes(s) || (s.includes(text) && text.length > 20))) {
                if (node.parentElement) {
                    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.parentElement.tagName)) continue;
                    
                    const el = node.parentElement;
                    const existingClasses = appliedElements.get(el) || [];
                    
                    if (suggestion.status === 'accepted') {
                        existingClasses.push('bg-green-200/50', 'outline', 'outline-2', 'outline-green-400');
                    } else if (suggestion.status === 'rejected') {
                        existingClasses.push('bg-red-200/50', 'outline', 'outline-2', 'outline-red-400', 'line-through');
                    } else {
                        existingClasses.push('bg-yellow-200/50', 'outline', 'outline-2', 'outline-yellow-400', 'transition-colors', 'duration-300', 'rounded-sm', 'shadow-md');
                    }
                    
                    appliedElements.set(el, existingClasses);
                }
            }
        }
    });

    // Apply classes
    appliedElements.forEach((classes, el) => {
        el.classList.add(...classes);
    });

    return () => {
        appliedElements.forEach((classes, el) => {
            el.classList.remove(...classes);
        });
    };
  }, [previewSuggestion, previewData, containerRef, state.chatHistory]);

  React.useEffect(() => {
    if (!containerRef) return;

    const updateDimensions = () => {
      if (containerRef) {
        setDimensions({
          width: containerRef.clientWidth,
          height: containerRef.clientHeight
        });
      }
    };

    // Initial measure
    updateDimensions();

    const resizeObserver = new ResizeObserver(() => {
      updateDimensions();
    });

    resizeObserver.observe(containerRef);

    return () => {
      resizeObserver.disconnect();
    };
  }, [containerRef]);

  const pageSizePx = getPageSizePx(previewData.pageFormat);
  const pageSizeCss = getPageSizeCss(previewData.pageFormat);

  React.useEffect(() => {
    if (dimensions.width === 0 || dimensions.height === 0) return;

    // Add padding to container calculation
    const padding = 32;
    const availableWidth = dimensions.width - padding;
    const availableHeight = dimensions.height - padding;

    const scaleWidth = availableWidth / pageSizePx.width;
    // Deliberately still fits a SINGLE page to the viewport, so a one-page
    // resume looks exactly as it always has. Extra pages are reached by
    // scrolling rather than by shrinking every resume to fit them all.
    const scaleHeight = availableHeight / pageSizePx.height;

    // Use the smaller scale to fit entirely, but don't go too small
    const newScale = Math.min(scaleWidth, scaleHeight);
    setScale(newScale);
  }, [dimensions, pageSizePx.width, pageSizePx.height]);

  // The rendered height of the resume at 100% scale. Measured rather than
  // estimated, because it depends on the template, typography, and page
  // padding all together. transform: scale() does not affect layout metrics,
  // so this stays correct at any zoom level.
  const [contentEl, setContentEl] = React.useState<HTMLDivElement | null>(null);
  const [contentHeight, setContentHeight] = React.useState(0);

  React.useEffect(() => {
    if (!contentEl) return;
    const measure = () => setContentHeight(contentEl.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(contentEl);
    return () => observer.disconnect();
  }, [contentEl]);

  // How many pages the content actually occupies. The paper grows to match,
  // instead of being clipped to the first page.
  const pageCount = Math.max(
    1,
    Math.ceil((contentHeight - PAGE_OVERFLOW_TOLERANCE_PX) / pageSizePx.height) || 1,
  );
  const pageBreaks = Array.from({ length: pageCount - 1 }, (_, index) => index + 1);

  return (
    <div
      className="resume-preview-container w-full h-full flex justify-center p-2 overflow-auto print:p-0 print:block print:w-full print:h-auto print:overflow-visible"
      // A single page stays vertically centred exactly as before; once the
      // resume spills over, it anchors to the top so page one is what you see
      // first and the rest is a scroll away.
      style={{ alignItems: pageCount > 1 ? 'flex-start' : 'center' }}
      ref={setContainerRef}
    >
      {dimensions.width === 0 ? (
        <div className="flex flex-col items-center gap-4">
          <Skeleton className="h-[600px] w-[400px]" />
        </div>
      ) : (
        <div
          className="resume-paper relative bg-white rounded-lg shadow-xl overflow-visible origin-center shrink-0 print:shadow-none print:m-0 print:w-full print:h-auto print:max-w-full"
          style={{
            width: pageSizePx.width * scale,
            height: pageSizePx.height * pageCount * scale,
          }}
        >
          <div
            id="resume-content"
            ref={setContentEl}
            className="relative print:shadow-none print:rounded-none"
            style={{
              width: pageSizeCss.width,
              // minHeight, not height: the paper is always at least one page
              // tall but is free to grow with the content. A fixed height
              // here (paired with overflow: hidden) was what silently hid
              // everything past page one.
              minHeight: pageSizeCss.height,
              fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
              padding: `${pagePadding}in`,
              color: '#050505ff',
              boxSizing: 'border-box',
              transform: `scale(${scale})`,
              transformOrigin: 'top left'
            }}
          >
            {renderTemplate()}
          </div>

          {/* Where each new sheet of paper starts. Screen-only: printing is
              paginated by the browser itself, which draws no such markers. */}
          {pageBreaks.map((pageIndex) => (
            <div
              key={pageIndex}
              aria-hidden="true"
              className="pointer-events-none absolute left-0 right-0 flex items-center justify-end print:hidden"
              style={{ top: pageSizePx.height * pageIndex * scale, transform: 'translateY(-50%)' }}
            >
              <div className="absolute left-0 right-0 border-t border-dashed border-slate-400/70" />
              <span className="relative mr-2 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium leading-none text-slate-500 shadow-sm">
                Page {pageIndex + 1}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
