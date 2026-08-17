# shop_dd — Base Sepolia USDC 쇼핑몰 PLAN v1

> 작성: Hermes (2026-08-17) · 분석: opencode Prometheus (P0) → Hermes gate → v2
> 목표: selling_dd가 알리익스프레스에서 소싱한 상품을 Base Sepolia 테스트넷에서 스마트컨트랙트(USDC) 결제로 파는 온라인 쇼핑몰.

## TL;DR

```
┌────────────────┐   DB 단방향 싱크(읽기전용)   ┌──────────────────────────┐
│  selling_dd    │ ─────────────────────────▶ │  shop_dd                 │
│  (소싱 파이프라인)│  products → shop products  │  ┌────────────────────┐  │
│  Postgres 5432 │                            │  │ Go API (Gin)        │  │
└────────────────┘                            │  │ - 상품/주문/지갑인증  │  │
                                              │  │ - sync worker(주기)  │  │
┌────────────────┐   HTTP X-Internal-Api-Key   │  └─────────┬──────────┘  │
│ blockchain-    │ ◀─────────────────────────┘            │              │
│ gateway 2nd    │  register / verify / execute            │              │
│ 인스턴스:8091   │ ──────────▶ ShopPayment.sol             │              │
│ (Base Sepolia) │              + MockUSDC (Base Sepolia)  │              │
└────────────────┘                                         ▼              │
                                              ┌────────────────────┐  │
                                              │ React/Vite 프론트   │  │
                                              │ (지갑연결→approve→pay│  │
                                              └────────────────────┘  │
                                              Postgres 5435 (자체 DB)  │
                                              └──────────────────────────┘
```

**분리 원칙 (핵심 요구사항)**:
1. shop_dd는 **selling_dd의 Python 코드를 절대 import/호출하지 않는다.** 데이터는 selling_dd Postgres `products` 테이블 → shop_dd DB로 **단방향 읽기전용 싱크**만 한다. → selling_dd 코드가 수정·깨져도 shop_dd는 마지막 동기화된 카탈로그로 계속 서빙.
2. **결제는 전부 blockchain-gateway를 경유** (HTTP + X-Internal-Api-Key). shop_dd는 컨트랙트·RPC를 직접 다루지 않는다. → gateway는 이미 Base Sepolia 전용 (`baseSepolia` 체인 하드코딩, `RPC_URL`/`CHAIN_ID=84532` 기본값).
3. **gateway 코드는 수정하지 않는다.** 두 번째 인스턴스를 env로만 띄운다 (PORT=8091 + shop 컨트랙트 주소 + shop용 INTERNAL_API_KEY).

## Scope

### Must have
- [ ] `~/shop_dd` 레포 (git init -b main, GitHub `sjh146/shop_dd` 푸시)
- [ ] `contracts/` — Hardhat(CommonJS) + `ShopPayment.sol` + MockUSDC(6자리)
  - ShopPayment.sol 인터페이스는 `AnalyistPayment.sol`과 **동일 ABI** (gateway `ANALYIST_PAYMENT_ABI`가 그대로 동작):
    `registerOrder(uint256,address,uint256)` onlyOwner, `cancelOrder(uint256)` onlyOwner,
    `pay(uint256,uint256)`, `processedOrderIds(uint256)`, `orderPayer(uint256)`, `orderAmount(uint256)`,
    이벤트 `PaymentSettled`/`OrderRegistered`/`OrderCancelled`
  - hardhat 테스트: 주문 멱등성, 미등록 pay revert, 금액·payer 바인딩, cancelOrder 복구, 6자리 소수
  - **Base Sepolia 배포 + 온체인 검증** (eth_call: symbol/decimals, owner 확인)
- [ ] `blockchain-gateway` shop 인스턴스 (deploy에 두 번째 compose 서비스 또는 별도 env 파일)
  - env: `PORT=8091`, `PAYMENT_CONTRACT_ADDRESS=<ShopPayment>`, `USDC_TOKEN_ADDRESS=<MockUSDC>`,
    `OPERATOR_PRIVATE_KEY=<테스트넷 키>`, `DEV_MOCK=false`, `INTERNAL_API_KEY=<shop 키>`, `RPC_URL=https://sepolia.base.org`
  - 검증: `/internal/blockchain/payment/register` → 온체인 tx → verify 응답 `{verified, tx_hash, order_id, payer, amount_usdc, chain_id}`
- [ ] `server/` — Go+Gin 백엔드 (cmall_dd 패턴 재사용)
  - Postgres(자체, 5435) 스키마: `products`, `orders`, `users/wallets`, `auth_challenges`
  - 지갑 인증: nonce→서명→JWT (cmall `wallet_auth.go` 패턴, DEV_FAKE_SIGNATURE dev 체인)
  - 상품 API: 목록/상세 (카탈로그는 싱크된 shop_dd DB만 읽음)
  - 주문 API: 생성 → gateway register → 사용자 pay → verify → paid 승격 (cmall `payments.go` 패턴:
    gateway 호출 `BLOCKCHAIN_GATEWAY_URL` env, `X-Internal-Api-Key`=INTERNAL_API_KEY env, `paymentMatchesGateway` 금액·payer 대조)
  - 주문 상태: `pending → registered → paid → fulfilled(수동)`
  - **sync worker**: selling_dd products → shop_dd products upsert (주기 실행, 실패해도 API 무중단, 읽기전용 DB 계정)
- [ ] `web/` — React+Vite 프론트: 상품 목록/상세, 장바구니, 지갑 연결(MetaMask, viem), USDC approve→pay, 주문 상태
  - UI: 흰 상품박스 + 회색 연결버튼 (cmall_dd 컨벤션), 한국어
- [ ] **CI/CD: Jenkins + GitHub 웹훅 + Docker test-fix 루프**
  - `~/jenkins` 스택 기동 (현재 down) + shop_dd 파이프라인(Jenkinsfile): 계약 테스트(hardhat) → 백엔드 테스트(go test, docker golang) → 프론트 빌드(vite) → 게이트웨이 테스트(vitest)
  - GitHub webhook 등록 (`re-register-webhook.sh` 패턴, cloudflared 터널 URL)
  - push → 자동 빌드 → 레드면 수정 커밋 → 그린까지 반복 (opencode가 test-fix 루프 수행)
- [ ] E2E: dev-mock 결제 E2E + Base Sepolia 실결제 E2E (사용자 지갑 키 없이: 테스트 payer 지갑 + approve→pay)
- [ ] Strix 보안 스캔 (스캔→수정→재스캔)
- [ ] 배포: docker-compose (shop-db, gateway-shop, shop-api, shop-web, nginx) + cloudflared

### Must NOT
- selling_dd Python 코드 import/서브프로세스 호출 (DB 싱크만)
- 메인넷/실 USDC/실체인 사용 — Base Sepolia 테스트넷 + MockUSDC 한정
- 개인키/시크릿 커밋 (env 주입, `.env` gitignore)
- blockchain-gateway 코드 수정 (env 인스턴스만)
- `docker volume prune` 금지

## 데이터 계약 (selling_dd → shop_dd)

selling_dd `products` (db/models.py 기준): `id, keyword, title, price, description, image_url, source_url, status, original_price, sale_price, discount_pct, margin_pct, volume, competition_score, raw_title, created_at, updated_at`

→ shop_dd `products`:
| 컬럼 | 출처/변환 |
|---|---|
| id (PK) | 자체 시퀀스 |
| selling_product_id (UNIQUE) | selling_dd.products.id |
| title / description / image_url / source_url | 그대로 |
| sale_price_krw (INTEGER) | sale_price(USD 문자열) → KRW (환율 1350 고정, `convert_usd_to_krw` 로직 참고) |
| original_price_krw | original_price → KRW |
| margin_pct | 그대로 |
| volume | 그대로 |
| status | 'listed' (manifest_ready + sale_price 존재) / 'unlisted' |
| stock | 기본 1 (오버셀 방지는 후속) |
| synced_at | 싱크 시각 |

- 싱크는 **INSERT ... ON CONFLICT (selling_product_id) DO UPDATE** upsert, 삭제는 soft (status=unlisted) — 카탈로그 안정성.

## 결제 흐름

1. 사용자: 상품 → 장바구니 → 주문 생성 → `POST /api/orders` (지갑 JWT 필수) → DB `pending`, order_id = DB id
2. shop 백엔드 → gateway `POST /internal/blockchain/payment/register` `{reference_id, wallet_address, amount_usdc}` → gateway가 owner 키로 온체인 `registerOrder(orderId, payer, amount)` (orderId = computeOrderId(reference_id) 결정적)
3. 프론트: `wallet.approve(MockUSDC, ShopPayment, amount)` → `wallet.pay(ShopPayment, orderId, amount)` — **사용자 서명** (메인넷 원칙, 운영자 대납 금지 — dev execute 엔드포인트는 사용 안 함)
4. 프론트 → `POST /api/orders/{id}/verify` → 백엔드 → gateway `verify` → `{verified, payer, amount_usdc, tx_hash}` 대조(`paymentMatchesGateway`) → `paid` 승격
5. 운영: paid 주문을 알리익스프레스 주문 접수 (수동, 후속 자동화) → `fulfilled`

금액 단위: USDC 6자리 소수. 백엔드가 KRW → USDC 환산(고정 1350, 1 USDC=1 USD).

## 레포 구조

```
shop_dd/
├── PLAN.md
├── contracts/          # Hardhat CommonJS: ShopPayment.sol, MockUSDC.sol, deploy/, test/
├── server/             # Go+Gin: main.go, internal/{handlers,models,database,sync,gatewayclient}/
├── web/                # React+Vite: 상품/상세/장바구니/결제
├── deploy/             # docker-compose.yml, nginx.conf, Jenkinsfile, .env.example
├── scripts/            # re-register-webhook.sh, e2e-*.sh
└── tests/              # E2E 스크립트
```

## 절차 (opencode 단계별 실행, 각 단계 Jenkins 게이트)

| 단계 | 내용 | 게이트 |
|---|---|---|
| P0 | **심층분석** (opencode Prometheus): PLAN.md + selling_dd/gateway/cmall 코드 실측 검증 → 분석서 | Hermes gate → v2 |
| P1 | 레포 골격 + Jenkins 기동(~/jenkins) + GitHub repo/웹훅 + Jenkinsfile (test-fix 루프 인프라) | Jenkins 빌드 그린 |
| P2 | contracts: ShopPayment/MockUSDC + hardhat 테스트 + Base Sepolia 배포 + 온체인 검증 | hardhat 그린 + 온체인 증거 |
| P3 | gateway shop 인스턴스 + register→pay→verify 실 E2E (테스트 payer) | E2E 로그 |
| P4 | 백엔드: DB/인증/상품/주문/싱크 워커 (dev-mock 결제 E2E 포함) | go test 그린 + E2E |
| P5 | 프론트: 목록/상세/장바구니/지갑결제 (dev-mock 체인) | 빌드 그린 + 수동 확인 |
| P6 | Strix 스캔 → 수정 → 재스캔, docker-compose 배포 + cloudflared, 웹훅 재등록 | 스캔 클린 + 배포 스모크 |

## 리스크 & 함정 (선행 학습)

- Base Sepolia RPC `eth_getLogs` 10,000블록 제한 → 검증은 **상태 기반** (processedOrderIds/orderPayer/orderAmount 멀티콜), 이벤트 로그는 `latest-10000` 바운드로만 (tx_hash 획득용)
- Base Sepolia USDC 없음 → MockUSDC(6자리) 직접 배포, faucet 대신 무제한 민트 (테스트넷이므로 허용)
- Base Sepolia ETH 펀딩: L1 faucet ETH는 L2 가스로 못 씀 — 브리지 필수 (0x4200...0010 L2StandardBridge, `l1TokenBridge()` eth_call로 실제 주소 조회 — 기억 의존 금지)
- viem 2.21.55 + typescript 5.6.3 고정 (최신 viem TS 폭발), hardhat config는 CommonJS `.js`
- pay() 성공 직후 processedOrderIds false일 수 있음 (RPC 인덱싱 지연) — 재조회
- Go 미설치(호스트) → Docker golang:1.21 빌드 (`docker run --rm -v $PWD:/app -w /app golang:1.21 bash -c "go build ./... && go vet ./... && go test ./..."`)
- Hermes 터미널 가드: docker compose up은 background=true, 빌드/검증/기동 분리 실행
- Jenkins 터널 URL 변경 시 webhook 재등록 필요
- opencode 산출물은 자기보고 불신 — 파일 존재/내용/테스트 출력 직접 검증

## 사용자 확정 사항
- "계획 심층분석까지하고 Jenkins, git웹훅, 도커를 이용해서 테스트 수정을 반복해줘" → P0 분석 후, **Jenkins+웹훅+Docker test-fix 루프**로 구현 진행
