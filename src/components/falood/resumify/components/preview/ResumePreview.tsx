import React, { useMemo, useLayoutEffect } from 'react';
import { useResume } from '@/components/falood/resumify/contexts/ResumeContext';
import { DEFAULT_PAGE_PADDING } from '@/components/falood/resumify/types/resume';
import { TechSidebarTemplate } from './templates/TechSidebarTemplate';
import { BusinessProfessionalTemplate } from './templates/BusinessProfessionalTemplate';
import { ModernMinimalTemplate } from './templates/ModernMinimalTemplate';
import { ElegantTimelineTemplate } from './templates/ElegantTimelineTemplate';
import { CreativeModernTemplate } from './templates/CreativeModernTemplate';
import { BJetProfessionalTemplate } from './templates/BJetProfessionalTemplate';
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

  const renderTemplate = () => {
    switch (previewData.template) {
      case 'tech-sidebar':
        return <TechSidebarTemplate data={previewData} />;
      case 'business-professional':
        return <BusinessProfessionalTemplate data={previewData} />;
      case 'modern-minimal':
        return <ModernMinimalTemplate data={previewData} />;
      case 'elegant-timeline':
        return <ElegantTimelineTemplate data={previewData} />;
      case 'creative-modern':
        return <CreativeModernTemplate data={previewData} />;
      case 'bjet-professional':
        return <BJetProfessionalTemplate data={previewData} />;
      default:
        return <TechSidebarTemplate data={previewData} />;
    }
  };

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

  React.useEffect(() => {
    if (dimensions.width === 0 || dimensions.height === 0) return;

    const isA4 = resumeData.pageFormat === 'a4';
    const pageWidth = isA4 ? 794 : 816; // A4: 210mm = 794px, Letter: 8.5in = 816px
    const pageHeight = isA4 ? 1123 : 1056; // A4: 297mm = 1123px, Letter: 11in = 1056px

    // Add padding to container calculation
    const padding = 32;
    const availableWidth = dimensions.width - padding;
    const availableHeight = dimensions.height - padding;

    const scaleWidth = availableWidth / pageWidth;
    const scaleHeight = availableHeight / pageHeight;

    // Use the smaller scale to fit entirely, but don't go too small
    const newScale = Math.min(scaleWidth, scaleHeight);
    setScale(newScale);
  }, [dimensions, resumeData.pageFormat]);

  const isA4 = resumeData.pageFormat === 'a4';
  const pageWidth = isA4 ? 794 : 816;
  const pageHeight = isA4 ? 1123 : 1056;

  return (
    <div
      className="resume-preview-container w-full h-full flex items-center justify-center p-2 print:p-0 print:block print:w-full print:h-auto"
      ref={setContainerRef}
    >
      {dimensions.width === 0 ? (
        <div className="flex flex-col items-center gap-4">
          <Skeleton className="h-[600px] w-[400px]" />
        </div>
      ) : (
        <div
          className="resume-paper bg-white rounded-lg shadow-xl overflow-visible origin-center print:shadow-none print:m-0 print:w-full print:h-auto print:max-w-full"
          style={{
            width: pageWidth * scale,
            height: pageHeight * scale,
            maxWidth: '100%',
            maxHeight: '100%'
          }}
        >
          <div
            id="resume-content"
            className="w-full h-full relative print:shadow-none print:rounded-none overflow-hidden"
            style={{
              width: isA4 ? '210mm' : '8.5in',
              height: isA4 ? '297mm' : '11in',
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
        </div>
      )}
    </div>
  );
};
