import React, { useMemo, useLayoutEffect } from 'react';
import { useResume } from '@/components/falood/resumify/contexts/ResumeContext';
import {
  getPageSizeCss,
  type ResumeData,
} from '@/components/falood/resumify/types/resume';
import { ResumeTemplateSwitch } from './ResumeTemplateSwitch';
import { applySuggestionToResumeData } from './AiSuggestions';
import { Skeleton } from '@/components/ui/skeleton';
import { getResumePageArea, getResumePaperStyle, getResumePageUtilizations, measureResumePages, type ResumePageSlice } from './resumePagination';

export const ResumePreview: React.FC<{
  onPageCountChange?: (count: number) => void;
  onPageLayoutChange?: (data: ResumeData, pageUtilizations: number[] | null) => void;
}> = ({ onPageCountChange, onPageLayoutChange }) => {
  const { state } = useResume();
  const { resumeData, previewSuggestion } = state;
  const previewData = useMemo(() => {
    if (previewSuggestion) {
      return applySuggestionToResumeData(resumeData, previewSuggestion);
    }
    return resumeData;
  }, [resumeData, previewSuggestion]);

  const { size: pageSizePx, usableHeight } = getResumePageArea(previewData);

  const [containerRef, setContainerRef] = React.useState<HTMLDivElement | null>(null);
  const [dimensions, setDimensions] = React.useState({ width: 0, height: 0 });
  const [slices, setSlices] = React.useState<ResumePageSlice[]>([]);

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
  }, [previewSuggestion, previewData, containerRef, state.chatHistory, slices.length]);

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

  const pageSizeCss = getPageSizeCss(previewData.pageFormat);
  const scale = Math.max(0.01, Math.min(
    (dimensions.width - 32) / pageSizePx.width,
    (dimensions.height - 32) / pageSizePx.height,
  ));

  const [source, setSource] = React.useState<HTMLDivElement | null>(null);
  const committedSource = React.useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!source) return;
    let active = true;
    const measure = () => {
      if (!active || !source.getClientRects().length) return;
      if (document.fonts.status === 'loading') {
        onPageLayoutChange?.(resumeData, null);
        setSlices((previous) => previous.length ? [] : previous);
        return;
      }
      const next = measureResumePages(source, usableHeight);
      if (onPageLayoutChange) {
        const committed = committedSource.current;
        const committedPages = committed ? measureResumePages(committed, usableHeight) : next;
        onPageLayoutChange(resumeData, getResumePageUtilizations(committedPages, usableHeight));
      }
      setSlices((previous) => previous.length === next.length && previous.every(
        (slice, index) => slice.start === next[index].start && slice.end === next[index].end,
      ) ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(source);
    if (committedSource.current) observer.observe(committedSource.current);
    void document.fonts.ready.then(measure);
    document.fonts.addEventListener('loadingdone', measure);
    document.fonts.addEventListener('loadingerror', measure);
    return () => {
      active = false;
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', measure);
      document.fonts.removeEventListener('loadingerror', measure);
    };
  }, [source, usableHeight, previewData, resumeData, onPageLayoutChange]);

  React.useEffect(() => {
    if (slices.length) onPageCountChange?.(slices.length);
  }, [slices.length, onPageCountChange]);

  return (
    <div
      className="resume-preview-container relative w-full h-full flex justify-center p-2 overflow-auto"
      style={{ ...getResumePaperStyle(previewData), alignItems: slices.length > 1 ? 'flex-start' : 'center' }}
      ref={setContainerRef}
    >
      <style>{`@page resume-studio { size: ${pageSizeCss.width} ${pageSizeCss.height}; margin: 0; }`}</style>
      <div className="resume-pagination-source" aria-hidden="true">
        <div className="resume-paper resume-pagination-measurement">
          <div ref={setSource}><ResumeTemplateSwitch data={previewData} /></div>
          {onPageLayoutChange && previewSuggestion && (
            <div ref={committedSource}><ResumeTemplateSwitch data={resumeData} /></div>
          )}
        </div>
      </div>
      {!dimensions.width || !slices.length ? (
        <Skeleton className="h-[600px] w-[400px]" />
      ) : (
        <div className="resume-sheet-stack">
          {slices.map((slice, index) => (
            <div key={index} className="resume-sheet-wrap" style={{
              width: pageSizePx.width * scale,
              height: pageSizePx.height * scale,
            }}>
              {index > 0 && <span className="resume-sheet-label">Page {index + 1}</span>}
              <div className="resume-paper resume-sheet" style={{ transform: 'scale(' + scale + ')' }}>
                <div className="resume-sheet-clip" style={{ height: slice.end - slice.start }}>
                  <div style={{ transform: 'translateY(' + (-slice.start) + 'px)' }}>
                    <ResumeTemplateSwitch data={previewData} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
