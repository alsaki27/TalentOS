import { getResumePageArea } from "@/components/falood/resumify/components/preview/resumePagination";
import { CSS_PX_PER_INCH, DEFAULT_FONT_SIZE, type ResumeData } from "@/components/falood/resumify/types/resume";
import { mapMetricsToPageFit, READABILITY_FLOOR_FONT_SIZE } from "./pageFitThresholds";

export const STUDIO_PAGE_FIT_CHANNEL = "talentos-studio-page-fit";
export const LEGACY_PAGE_FIT_BATCH_SIZE = 6;

export function studioPageFit(
  data: Pick<ResumeData, "pageFormat" | "pagePadding" | "fontSize">,
  pageUtilizations: unknown,
) {
  if (!data || !Array.isArray(pageUtilizations) || pageUtilizations.length === 0 || pageUtilizations.length > 200 ||
      !pageUtilizations.every((fill) => Number.isFinite(fill) && fill >= 0 && fill <= 1)) return null;

  const round = (value: number) => Math.round(value * 1000) / 1000;
  const pageCount = pageUtilizations.length;
  const lastFill = pageUtilizations[pageCount - 1];
  const contentUtilization = pageUtilizations.reduce((total, fill) => total + fill, 0) / pageCount;
  const { usableHeight } = getResumePageArea(data);
  const measured = mapMetricsToPageFit({
    pageCount,
    contentUtilization: round(contentUtilization),
    bottomWhitespaceInches: round((1 - lastFill) * usableHeight / CSS_PX_PER_INCH),
    overflow: pageCount > 1,
    readable: (Number.isFinite(data.fontSize) ? data.fontSize : DEFAULT_FONT_SIZE) >= READABILITY_FLOOR_FONT_SIZE,
  });
  return { ...measured!, pageUtilizations: pageUtilizations.map(round) };
}
