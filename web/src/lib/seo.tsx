import { useEffect } from 'react'

/** 페이지별 문서 제목 — 검색엔진·AI 에이전트가 현재 화면을 식별할 수 있게 한다 */
export function usePageTitle(title?: string): void {
  useEffect(() => {
    document.title = title
      ? `${title} — 사이버몰`
      : '사이버몰 — MetaMask 전용 결제 (테스트넷)'
  }, [title])
}

/**
 * schema.org JSON-LD 구조화 데이터 — 검색엔진과 AI 에이전트가
 * 상품명/가격/재고 상태를 DOM 파싱 없이 읽을 수 있게 한다.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      data-testid="json-ld"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}
