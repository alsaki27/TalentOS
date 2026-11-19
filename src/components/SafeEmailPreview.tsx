"use client";

import { CSSProperties, useEffect, useState } from "react";

const ALLOWED_TAGS = [
  "a", "b", "blockquote", "br", "caption", "code", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6",
  "hr", "i", "li", "ol", "p", "pre", "s", "span", "strong", "sub", "sup", "table", "tbody", "td", "th",
  "thead", "tr", "u", "ul",
];

const ALLOWED_ATTRIBUTES = [
  "align", "cellpadding", "cellspacing", "colspan", "href", "rowspan", "style", "title", "valign", "width",
];

const SAFE_STYLE_PROPERTIES = new Set([
  "background-color", "border", "border-bottom", "border-color", "border-left", "border-radius", "border-right",
  "border-style", "border-top", "border-width", "color", "font-family", "font-size", "font-style", "font-weight",
  "line-height", "margin", "margin-bottom", "margin-left", "margin-right", "margin-top", "padding",
  "padding-bottom", "padding-left", "padding-right", "padding-top", "text-align", "text-decoration", "vertical-align",
]);

export function sanitizeEmailPreviewStyle(style: string) {
  const declarations: string[] = [];
  for (const declaration of style.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 1) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (
      !SAFE_STYLE_PROPERTIES.has(property) ||
      !value ||
      value.length > 200 ||
      /url\s*\(|expression\s*\(|javascript\s*:|@import|behavior\s*:|\\/i.test(value)
    ) continue;
    declarations.push(`${property}: ${value}`);
  }
  return declarations.join("; ");
}

function isSafePreviewHref(value: string) {
  const href = value.trim();
  if (!href || href.startsWith("//") || /[\u0000-\u001f\\]/.test(href)) return false;
  if (href.startsWith("#") || href.startsWith("/")) return true;
  try {
    const parsed = new URL(href, window.location.origin);
    return parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "mailto:";
  } catch {
    return false;
  }
}

export default function SafeEmailPreview({
  html,
  className,
  style,
}: {
  html: string;
  className?: string;
  style?: CSSProperties;
}) {
  const [safeHtml, setSafeHtml] = useState("");

  useEffect(() => {
    let cancelled = false;
    void import("dompurify").then(({ default: createDOMPurify }) => {
      const purifier = createDOMPurify(window);
      purifier.addHook("uponSanitizeAttribute", (_node, data) => {
        if (data.attrName === "href" && !isSafePreviewHref(data.attrValue)) {
          data.keepAttr = false;
        }
        if (data.attrName === "style") {
          data.attrValue = sanitizeEmailPreviewStyle(data.attrValue);
          data.keepAttr = Boolean(data.attrValue);
        }
      });
      purifier.addHook("afterSanitizeAttributes", (node) => {
        if (node.nodeName.toLowerCase() === "a" && node.hasAttribute("href")) {
          node.setAttribute("target", "_blank");
          node.setAttribute("rel", "noopener noreferrer");
        }
      });
      const sanitized = purifier.sanitize(html, {
        ALLOWED_TAGS,
        ALLOWED_ATTR: ALLOWED_ATTRIBUTES,
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: false,
        FORBID_TAGS: ["base", "embed", "form", "iframe", "img", "input", "link", "math", "meta", "object", "script", "source", "style", "svg", "video", "audio"],
        FORBID_ATTR: ["action", "formaction", "src", "srcset", "xlink:href"],
      });
      if (!cancelled) setSafeHtml(sanitized);
    }).catch(() => {
      if (!cancelled) setSafeHtml("");
    });

    return () => { cancelled = true; };
  }, [html]);

  return <div className={className} style={style} dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}
