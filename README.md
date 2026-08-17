# shop_dd

Base Sepolia 테스트넷에서 스마트컨트랙트(USDC)로 selling_dd가 알리익스프레스에서 소싱한 상품을 판매하는 온라인 쇼핑몰.

- 설계: [PLAN.md](PLAN.md) (v2) · P0 심층분석: [P0_ANALYSIS.md](P0_ANALYSIS.md)
- 아키텍처: shop_dd(Go+Gin+React/Vite) ↔ blockchain-gateway(HTTP, X-Internal-Api-Key) ↔ ShopPayment.sol + MockUSDC (Base Sepolia)
- 분리 원칙: selling_dd 코드 import 금지 — DB 단방향 싱크 + gateway 경유 결제
- CI: Jenkins + GitHub 웹훅 + Docker (test-fix 루프)
