// The resume preview paginates against these values, so a drift here would
// silently mis-place every page boundary. They are derived from the real
// paper sizes (CSS defines 1in as exactly 96px) rather than restated as pixel
// literals, and these assertions pin the derivation to the known-good numbers
// the preview used before it was made multi-page aware.

import { describe, expect, it } from "vitest";
import { getPageSizePx, getPageSizeCss, CSS_PX_PER_INCH } from "@/components/falood/resumify/types/resume";

describe("resume page geometry", () => {
  it("derives A4 in CSS pixels", () => {
    const { width, height } = getPageSizePx("a4");
    expect(Math.round(width)).toBe(794); // 210mm
    expect(Math.round(height)).toBe(1123); // 297mm
  });

  it("derives US Letter in CSS pixels", () => {
    expect(getPageSizePx("letter")).toEqual({ width: 816, height: 1056 });
  });

  it("keeps the pixel size and the CSS length in agreement", () => {
    // 8.5in x 11in at 96px/in must match what getPageSizePx reports, or the
    // paper element and the page-boundary maths would disagree.
    const px = getPageSizePx("letter");
    expect(getPageSizeCss("letter")).toEqual({ width: "8.5in", height: "11in" });
    expect(px.width).toBe(8.5 * CSS_PX_PER_INCH);
    expect(px.height).toBe(11 * CSS_PX_PER_INCH);
  });

  it("returns the CSS lengths each format is actually laid out with", () => {
    expect(getPageSizeCss("a4")).toEqual({ width: "210mm", height: "297mm" });
  });

  it("falls back to A4 for an unrecognised page format", () => {
    expect(getPageSizePx("tabloid" as any)).toEqual(getPageSizePx("a4"));
  });
});
