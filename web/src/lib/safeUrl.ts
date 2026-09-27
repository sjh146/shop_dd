// External link safety check (CWE-79: blocks javascript:, data: and protocol-relative URLs).
// Parses as an absolute URL with no base — rejects protocol-relative (//evil.com) and scheme injection.
export function isSafeExternalUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    // Parsing without a base rejects javascript:alert(1), //evil.com and similar payloads here.
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
