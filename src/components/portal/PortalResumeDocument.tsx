"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ResumeTemplateSwitch } from "@/components/falood/resumify/components/preview/ResumeTemplateSwitch";
import { studioDocumentToResumeData } from "@/lib/falood/studioDocumentToResumeData";
import { DEFAULT_PAGE_PADDING } from "@/components/falood/resumify/types/resume";

// Renders a tailored resume with the exact same templates the TalentOS studio
// uses, by running the stored content through the same studioDocumentToResumeData
// adapter the rest of the app does (it handles both real content shapes -
// studio-document and Resumify-native) and handing the result to the shared
// ResumeTemplateSwitch.
//
// The one difference from the studio's ResumePreview is height: that one fits a
// single page into a fixed viewport and clips the overflow, because it is an
// editing surface. Here the candidate is reading the finished document, so the
// page is scaled to the container's WIDTH and allowed to run to its natural
// full height - no clipping, nothing hidden below the fold.
export default function PortalResumeDocument({ content }: { content: unknown }) {
  const resumeData = useMemo(() => studioDocumentToResumeData(content as any), [content]);
  const [containerRef, setContainerRef] = useState<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [scaledHeight, setScaledHeight] = useState<number>(0);

  const isA4 = resumeData.pageFormat === "a4";
  const pageWidth = isA4 ? 794 : 816;
  const pagePadding = resumeData.pagePadding ?? DEFAULT_PAGE_PADDING;

  // Scale to fit the available width, never upscaling past 1:1 and never
  // shrinking below MIN_SCALE - fitting a full letter page into a ~390px
  // phone would land around 0.45 and render the body text at roughly 5px,
  // which is not readable. Below that floor the document scrolls sideways
  // inside its own card instead (the card clips, so the page itself never
  // gains a horizontal scrollbar).
  useEffect(() => {
    if (!containerRef) return;
    const MIN_SCALE = 0.62;
    const measure = () => {
      const available = containerRef.clientWidth;
      if (available > 0) setScale(Math.min(Math.max(available / pageWidth, MIN_SCALE), 1));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(containerRef);
    return () => observer.disconnect();
  }, [containerRef, pageWidth]);

  // A CSS transform does not affect layout, so the scaled page would otherwise
  // leave a gap (or overlap what follows) equal to its unscaled height. Mirror
  // the real rendered height back onto the wrapper so the surrounding page
  // flows correctly at every scale.
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const measure = () => setScaledHeight(page.offsetHeight * scale);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    return () => observer.disconnect();
  }, [scale, resumeData]);

  return (
    <div className="portal-resume-doc" ref={setContainerRef}>
      {/* Width is the scaled page, not the container, so a viewport wider than
          the page centres the document instead of stranding it against the
          left edge with dead space beside it. */}
      <div
        className="portal-resume-doc-page"
        style={{ width: pageWidth * scale, height: scaledHeight || undefined }}
      >
        <div
          ref={pageRef}
          className="portal-resume-doc-inner"
          style={{
            width: isA4 ? "210mm" : "8.5in",
            padding: `${pagePadding}in`,
            fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
            color: "#050505",
            boxSizing: "border-box",
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <ResumeTemplateSwitch data={resumeData} />
        </div>
      </div>
    </div>
  );
}
