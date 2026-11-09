"use client";

import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { ResumeTemplateSwitch } from "@/components/falood/resumify/components/preview/ResumeTemplateSwitch";
import {
  getResumePageArea,
  getResumePageUtilizations,
  getResumePaperStyle,
  measureResumePages,
} from "@/components/falood/resumify/components/preview/resumePagination";
import type { ResumeData } from "@/components/falood/resumify/types/resume";
import { studioPageFit } from "@/lib/falood/studioPageFit";

export interface LegacyPageFitTarget {
  id: string;
  versionId: string;
  updatedAt?: string | null;
  key: string;
}

export interface LegacyPageFitResult {
  target: LegacyPageFitTarget;
  metrics: ReturnType<typeof studioPageFit>;
}

interface LayoutRow {
  id: string;
  resume_version_id: string;
  page_fit_resume_updated_at: string | null;
  data: ResumeData;
}

class LayoutBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function LegacyPageFitBatch({ targets, onMeasured }: {
  targets: LegacyPageFitTarget[];
  onMeasured: (results: LegacyPageFitResult[]) => void;
}) {
  // The parent keys this component by resume and revision.
  const [requested] = useState(() => targets);
  const [layouts, setLayouts] = useState<LayoutRow[] | null>(null);
  const sources = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    const request = new AbortController();
    const ids = requested.map((target) => target.id).join(",");
    fetch(`/api/application-queue/page-fit?layout=legacy&ids=${ids}`, {
      cache: "no-store",
      signal: request.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Page layout unavailable");
        const { items }: { items: LayoutRow[] } = await response.json();
        if (!request.signal.aborted) setLayouts(items);
      })
      .catch(() => {
        if (!request.signal.aborted) setLayouts([]);
      });
    return () => request.abort();
  }, [requested]);

  useEffect(() => {
    if (!layouts) return;
    let active = true;
    const elements = [...sources.current.values()];
    // Trigger layout before checking the fonts required by these templates.
    elements.forEach((element) => element.getBoundingClientRect());
    const images = elements.flatMap((element) => Array.from(element.querySelectorAll("img")));
    const decode = Promise.all(images.map((image) => image.decode().catch(() => {})));
    let timeout: number | undefined;
    const imageLimit = new Promise<void>((resolve) => { timeout = window.setTimeout(resolve, 3000); });
    void Promise.all([document.fonts.ready, Promise.race([decode, imageLimit])]).then(() => {
      window.clearTimeout(timeout);
      if (!active) return;
      const byId = new Map(layouts.map((layout) => [layout.id, layout]));
      onMeasured(requested.map((target) => {
        const layout = byId.get(target.id);
        const source = sources.current.get(target.id);
        if (!layout || layout.resume_version_id !== target.versionId ||
            (layout.page_fit_resume_updated_at ?? null) !== (target.updatedAt ?? null) ||
            !source?.getBoundingClientRect().height ||
            Array.from(source.querySelectorAll("img")).some((image) => !image.complete)) {
          return { target, metrics: null };
        }
        const { usableHeight } = getResumePageArea(layout.data);
        const pages = measureResumePages(source, usableHeight);
        return { target, metrics: studioPageFit(layout.data, getResumePageUtilizations(pages, usableHeight)) };
      }));
    });
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [layouts, onMeasured, requested]);

  return (
    <div className="resume-pagination-source" aria-hidden="true">
      {layouts?.map(({ id, data }) => (
        <LayoutBoundary key={id}>
          <div className="resume-paper resume-pagination-measurement" style={getResumePaperStyle(data)}>
            <div ref={(element) => {
              if (element) sources.current.set(id, element);
              else sources.current.delete(id);
            }}>
              <ResumeTemplateSwitch data={data} />
            </div>
          </div>
        </LayoutBoundary>
      ))}
    </div>
  );
}
