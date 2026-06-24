import React from 'react';
import { useResume } from '@/components/falood/resumify/contexts/ResumeContext';
import { TechSidebarTemplate } from './templates/TechSidebarTemplate';
import { BusinessProfessionalTemplate } from './templates/BusinessProfessionalTemplate';
import { ModernMinimalTemplate } from './templates/ModernMinimalTemplate';
import { ElegantTimelineTemplate } from './templates/ElegantTimelineTemplate';
import { CreativeModernTemplate } from './templates/CreativeModernTemplate';
import { BJetProfessionalTemplate } from './templates/BJetProfessionalTemplate';

import { Skeleton } from '@/components/ui/skeleton';

export const ResumePreview: React.FC = () => {
  const { state } = useResume();
  const { resumeData } = state;

  const renderTemplate = () => {
    switch (resumeData.template) {
      case 'tech-sidebar':
        return <TechSidebarTemplate data={resumeData} />;
      case 'business-professional':
        return <BusinessProfessionalTemplate data={resumeData} />;
      case 'modern-minimal':
        return <ModernMinimalTemplate data={resumeData} />;
      case 'elegant-timeline':
        return <ElegantTimelineTemplate data={resumeData} />;
      case 'creative-modern':
        return <CreativeModernTemplate data={resumeData} />;
      case 'bjet-professional':
        return <BJetProfessionalTemplate data={resumeData} />;
      default:
        return <TechSidebarTemplate data={resumeData} />;
    }
  };

  const [containerRef, setContainerRef] = React.useState<HTMLDivElement | null>(null);
  const [scale, setScale] = React.useState(0.8);
  const [dimensions, setDimensions] = React.useState({ width: 0, height: 0 });

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
              fontSize: '11px',
              lineHeight: '1.35',
              fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
              padding: '0.75in',
              color: '#1f2937',
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