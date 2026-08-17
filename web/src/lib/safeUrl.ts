// 외부 링크 안전 검증 (CWE-79: javascript:/data:/프로토콜 상대 URL 차단)
// 기준 없이 절대 URL로만 파싱 — 프로토콜 상대(//evil.com)와 스킴 주입을 모두 거부.
export function isSafeExternalUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    // base 없이 파싱 → javascript:alert(1), //evil.com 등이 여기서 걸림
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
