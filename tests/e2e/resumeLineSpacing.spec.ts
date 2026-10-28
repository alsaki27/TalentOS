/**
 * Regression test for the Falood resume studio's Line Spacing control
 * (Customize panel). Root cause this guards against (2026-10-27):
 * every resume template uses Tailwind's text-xs/text-sm/text-base/...
 * utility classes for nearly all of its text, and each of those utilities
 * bakes in its OWN line-height as part of the class definition. A property
 * set directly on an element always wins over one only set on an ancestor
 * (inherited or not, !important on the ancestor's own rule or not) - CSS
 * only falls back to inheritance when nothing targets the property on that
 * element directly, and these utilities always do. So setting line-height
 * only on the resume's root element - the first, incomplete fix - could
 * never actually reach text carrying one of these classes.
 *
 * The real fix (see src/app/globals.css, the `.resume-paper *` /
 * `.portal-resume-doc-inner *` rule): the resume root sets a
 * `--resume-line-height` CSS custom property from the live, admin-chosen
 * value (ResumePreview.tsx, PortalResumeDocument.tsx), and one generic rule
 * applies `line-height: var(--resume-line-height, 1.625) !important` to
 * every descendant, regardless of what Tailwind class it carries - current
 * or any added to a template in the future. This test proves that
 * mechanism against the REAL, served, compiled stylesheet (not a jsdom
 * approximation or a hand-copied snippet of the rule that could silently
 * drift from the real file), so a future edit that reintroduces a
 * competing line-height rule, or removes this one, fails CI here instead
 * of silently breaking the Customize panel again.
 *
 * Needs a running app to serve its compiled CSS, but no login - this
 * exercises a CSS mechanism, not an authenticated page.
 */
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

// Mirrors DEFAULT_LINE_SPACING in src/components/falood/resumify/types/resume.ts
// and the fallback in the CSS rule itself. If either of those ever changes,
// this constant (and the assertions below) must change with it - that
// coupling is intentional: a drift between them is exactly the kind of bug
// this test exists to catch.
const DEFAULT_LINE_SPACING = 1.625;

interface ComputedTextMetrics {
  fontSizePx: number;
  lineHeightPx: number;
}

async function measureInjectedResumeText(
  page: import("@playwright/test").Page,
  options: { lineSpacing?: number; insideResumePaper: boolean },
): Promise<Record<"xs" | "sm" | "base" | "xl" | "threeXl", ComputedTextMetrics>> {
  return page.evaluate((opts) => {
    const host = document.createElement("div");
    const varAttr = typeof opts.lineSpacing === "number" ? `style="--resume-line-height: ${opts.lineSpacing};"` : "";
    const inner = `
      <p class="text-xs" id="m-xs">xs</p>
      <p class="text-sm" id="m-sm">sm</p>
      <p class="text-base" id="m-base">base</p>
      <p class="text-xl" id="m-xl">xl</p>
      <h1 class="text-3xl" id="m-3xl">3xl</h1>
    `;
    host.innerHTML = opts.insideResumePaper
      ? `<div class="resume-paper"><div id="resume-content" ${varAttr}>${inner}</div></div>`
      : `<div id="plain-wrapper" ${varAttr}>${inner}</div>`;
    document.body.appendChild(host);

    const read = (id: string): ComputedTextMetrics => {
      const el = document.getElementById(id)!;
      const cs = getComputedStyle(el);
      return { fontSizePx: parseFloat(cs.fontSize), lineHeightPx: parseFloat(cs.lineHeight) };
    };
    const result = {
      xs: read("m-xs"),
      sm: read("m-sm"),
      base: read("m-base"),
      xl: read("m-xl"),
      threeXl: read("m-3xl"),
    };
    host.remove();
    return result;
  }, options);
}

test.describe("Resume studio Line Spacing control (CSS mechanism)", () => {
  test("a chosen line spacing value applies to every Tailwind text-size class used by the templates", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

    const chosen = 2.0;
    const metrics = await measureInjectedResumeText(page, { lineSpacing: chosen, insideResumePaper: true });

    for (const [label, m] of Object.entries(metrics)) {
      // line-height is a unitless multiplier of the element's OWN font size
      // (consistent with how skarionPdfDocument.tsx's export math and the
      // Customize panel's slider both already treat it) - not a fixed
      // pixel value, so this must hold at every text size a template uses.
      expect(m.lineHeightPx, `${label}: line-height should be fontSize * ${chosen}`).toBeCloseTo(m.fontSizePx * chosen, 1);
    }
  });

  test("falls back to the documented default when no value is set, and it differs from Tailwind's own unscoped default", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

    const withFallback = await measureInjectedResumeText(page, { insideResumePaper: true });
    const tailwindNative = await measureInjectedResumeText(page, { insideResumePaper: false });

    // Proves the fallback is genuinely this CSS variable mechanism
    // computing a ratio, not Tailwind's own baked-in line-height surviving
    // unmodified by coincidence.
    expect(withFallback.sm.lineHeightPx).not.toBeCloseTo(tailwindNative.sm.lineHeightPx, 1);
    expect(withFallback.sm.lineHeightPx).toBeCloseTo(withFallback.sm.fontSizePx * DEFAULT_LINE_SPACING, 1);
  });

  test("updates immediately when the custom property changes, with no re-render - proves the control is reactive in real time", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

    const after = await page.evaluate(() => {
      const host = document.createElement("div");
      host.innerHTML = `<div class="resume-paper"><div id="resume-content" style="--resume-line-height: 1.1;"><p class="text-sm" id="m-sm">sm</p></div></div>`;
      document.body.appendChild(host);
      const el = document.getElementById("m-sm")!;
      const before = parseFloat(getComputedStyle(el).lineHeight);

      // Simulates exactly what a React re-render does after the slider
      // moves: only the custom property on the root changes.
      document.getElementById("resume-content")!.style.setProperty("--resume-line-height", "1.8");
      const afterChange = parseFloat(getComputedStyle(el).lineHeight);
      const fontSizePx = parseFloat(getComputedStyle(el).fontSize);

      host.remove();
      return { before, afterChange, fontSizePx };
    });

    expect(after.afterChange).not.toBeCloseTo(after.before, 1);
    expect(after.afterChange).toBeCloseTo(after.fontSizePx * 1.8, 1);
  });
});
