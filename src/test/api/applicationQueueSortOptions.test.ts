import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ApplicationQueuePage from "@/app/application-queue/page";

describe("application queue sort selector", () => {
  it("renders newest AE review first by default and offers oldest first", () => {
    const html = renderToStaticMarkup(createElement(ApplicationQueuePage));
    const select = html.match(/<select[^>]*aria-label="Sort application queue"[^>]*>([\s\S]*?)<\/select>/)?.[1];
    expect(select).toBeDefined();
    expect(select).toMatch(/<option value="ae_review_pending_newest" selected="">AE review pending \(newest first\)<\/option>/);
    expect(select).toContain('<option value="ae_review_pending">AE review pending (oldest first)</option>');
    expect(select).toContain('value="due"');
    expect(select).toContain('value="final_score"');
    expect(select).toContain('value="average_score"');
  });
});
