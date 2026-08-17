# P5 태스크 — React/Vite 프론트 (opencode Atlas)

질문하지 말고 끝까지 진행해. 완료 후 커밋/푸시 (Jenkins 자동 빌드).

## 배경
`~/shop_dd/PLAN.md` §P5 + **디자인 가이드(필수!)** + `P0_ANALYSIS.md` 읽어라.
- 백엔드(P4 완료): Go+Gin :8095 — API: `POST /api/auth/nonce`, `POST /api/auth/verify` (0xdev dev 서명 허용), `GET /api/products`, `GET /api/products/:id`, `POST /api/orders` (JWT), `POST /api/orders/:id/verify` (JWT), `GET /api/orders`, `GET /api/orders/:id`
- 컨트랙트: ShopPayment `0x7fD9208e601c69639F6875EC24717e8476A2cCb1`, MockUSDC `0xe0661BAff428a1d57cb717E5Ce15Deca4F847E90` (Base Sepolia 84532)
- 주문 생성 응답에 pay용 필드: `{order_id, amount_usdc_micro, gateway_order_id, contract_address, usdc_token}` — gateway_order_id를 pay()의 orderId로 사용
- viem 2.21.55 고정 (gateway와 동일 버전), React 18 + Vite + TS

## ⚠️ 디자인 가이드 (PLAN.md — AI 티 금지, 필수 준수)
- **금지**: 그라데이션 히어로/글래스모피즘/네온, 카피에 이모티콘·"초특가!" 문체, Inter/시스템 폰트, 플레이스홀더 대문자, Lorem ipsum, 다크+골드
- **적용**: 크림/화이트 배경(#FAF9F6) + 차콜(#2A2A28) + 브라스(#B8860B). 헤딩 Noto Serif KR + 바디 고딕. 실제 점주 톤 카피. 상품 카드=흰 박스+실사 이미지+손으로 붙인 듯한 할인 태그. 지갑 연결 버튼 회색. USDC 결제는 조용한 안내(푸터/결제 단계), 크립토 락 금지.
- 완료 후 **AI 티 자체점검**: 페이지별로 금지 항목 하나도 없는지 스크린샷/코드로 확인

## 1. `~/shop_dd/web/` (Vite + React + TS)
```
web/
├── package.json          # react 18, vite, viem 2.21.55, react-router-dom
├── vite.config.ts        # dev proxy: /api → http://localhost:8095
├── index.html            # Noto Serif KR + 고딕 폰트 (한국어)
├── src/
│   ├── main.tsx, App.tsx # 라우터: / (목록), /products/:id, /cart, /checkout, /orders, /orders/:id
│   ├── lib/api.ts        # fetch 래퍼 (JWT localStorage)
│   ├── lib/wallet.ts     # viem: connect(MetaMask), approve, pay, getAddress
│   ├── components/       # ProductCard(할인 태그), Header(회색 지갑 연결 버튼), Footer(USDC 안내 문구)
│   └── pages/
│       ├── ProductList.tsx   # listed 상품 카드 그리드 (원가/판매가/할인율 표)
│       ├── ProductDetail.tsx # 이미지/설명/가격표/장바구니 담기
│       ├── CartPage.tsx      # 수량/합계 KRW
│       ├── CheckoutPage.tsx  # 지갑 연결 → 주문 생성 → approve → pay(사용자 서명) → verify → paid
│       ├── OrdersPage.tsx    # 내 주문 목록 (상태 배지: pending/registered/paid/fulfilled)
│       └── OrderDetailPage.tsx # 상태/거래해시/안내
└── Dockerfile.ci         # node:22, COPY ., npm ci, npm run build (Jenkins용)
```

## 2. 결제 흐름 (CheckoutPage)
1. 지갑 연결 (MetaMask, Base Sepolia 네트워크 체크 — 아니면 안내 문구)
2. 지갑 인증: nonce → 서명(personal_sign) → JWT (개발은 0xdev 버튼 허용? **아니요** — 프론트는 항상 실서명, dev 서명은 E2E 스크립트 전용)
3. `POST /api/orders` (items, walletAddress) → 응답 저장
4. `MockUSDC.approve(contract_address, amount_usdc_micro)` (잔액 부족 시 안내: "테스트 USDC가 필요해요 — faucet 안내")
5. `ShopPayment.pay(gateway_order_id, amount_usdc_micro)` — MetaMask 서명
6. `POST /api/orders/:id/verify` → paid 확인 → 주문 상세로 이동 (tx_hash 표시)
7. 실패 케이스: 사용자 거절/잔액 부족/네트워크 오류 각각 한국어 안내 (에러 그대로 노출 금지)

## 3. Jenkins 스테이지 추가 (Jenkinsfile)
- `web/Dockerfile.ci` 빌드 + 실행으로 `npm run build` (산출물 dist 확인) — `docker build -f web/Dockerfile.ci -t shop-web-ci . && docker run --rm shop-web-ci`
- (빌드 실패 exit code 확인 — `| tail` 금지)

## 4. 로컬 수동 확인 (실행 증거)
- 백엔드(8095)+프론트(vite dev) 기동 → 상품 목록 렌더 (싱크된 상품 1개 이상)
- `curl localhost:5173` HTML + 제품 API 200 확인
- 결과 출력 저장: `.omo/evidence/p5-frontend.txt`

## 완료 게이트
- vite build 그린 (CI 포함) · 목록/상세/장바구니/결제 페이지 동작 · 디자인 가이드 준수
- 커밋: `"P5: React/Vite 프론트 (상품/장바구니/USDC 결제)"` + push. 마지막에 요약(페이지 목록, 빌드 결과, AI 티 점검 결과)
