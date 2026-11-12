// Which addresses an answer may link to (M3-T2). Only absolute web, mail and phone addresses: a script address,
// a data address or a relative path stays plain text.
const ALLOWED = new Set(["https:", "http:", "mailto:", "tel:"]);

export function safeHref(href: unknown): string | null {
  if (typeof href !== "string" || !href.trim()) return null;
  try {
    const url = new URL(href.trim()); // throws for anything relative, so nothing points back at our own pages
    return ALLOWED.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
