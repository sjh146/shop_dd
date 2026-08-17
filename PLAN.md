# shop_dd — Base Sepolia USDC 쇼핑몰 PLAN v2

> v1 (Hermes 2026-08-17) → **P0 심층분석 (opencode Prometheus, 실코드 실측) → Hermes gate 리뷰 통과 → v2 확정**
> P0 판정: **조건부 GO** — §6 필수 변경 5건 반영함. 증거: `P0_ANALYSIS.md` (검증표 G1-G9/D1-D7/C1-C9).
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
2. **결제는 전부 blockchain-gateway를 경유** (HTTP + X-Internal-Api-Key). shop_dd는 컨트랙트·RPC를 직접 다루지 않는다.
3. **gateway 코드는 수정하지 않는다.** 두 번째 인스턴스를 env로만 띄운다 (PORT=8091 + shop 컨트랙트 + shop용 INTERNAL_API_KEY). — P0 G6 ✅ 검증됨.

## Scope

### Must have
- [ ] `~/shop_dd` 레포 (git init -b main, GitHub `sjh146/shop_dd` — 생성 완료, push 완료)
- [ ] `contracts/` — Hardhat(CommonJS) + `ShopPayment.sol` + MockUSDC(6자리)
  - **ShopPayment.sol은 gateway ABI와 100% 호환** (P0 G5 ⚠️ 해소):
    - 함수: `registerOrder(uint256,address,uint256)` onlyOwner, `cancelOrder(uint256)` onlyOwner, `pay(uint256,uint256)`, `processedOrderIds(uint256)`, `orderPayer(uint256)`, `orderAmount(uint256)`
    - 이벤트: `PaymentSettled(uint256 indexed orderId, address indexed payer, uint256 amountUsdc, address indexed treasury)` ← **treasury(indexed) 필수** (AnalyistPayment.sol:40-44 그대로), `OrderRegistered`, `OrderCancelled`, `TreasuryUpdated`
  - hardhat 테스트: 주문 멱등성, 미등록 pay revert, 금액·payer 바인딩, cancelOrder 복구, 6자리 소수
  - **Base Sepolia 배포 + 온체인 검증** (eth_call: symbol/decimals, owner 확인)
- [ ] `blockchain-gateway` shop 인스턴스 (PORT=8091)
  - env: `PORT=8091`, `PAYMENT_CONTRACT_ADDRESS=<ShopPayment>`, `USDC_TOKEN_ADDRESS=<MockUSDC>`, `OPERATOR_PRIVATE_KEY=<테스트넷 키, owner=배포자>`, `DEV_MOCK=false`, `INTERNAL_API_KEY=<shop 키>`, `RPC_URL=https://sepolia.base.org`
  - 검증: register → 온체인 tx → verify 응답 `{verified, tx_hash, order_id, payer, amount_usdc, chain_id, contract_address}`
- [ ] `server/` — Go+Gin 백엔드 (cmall_dd 패턴 복사-개조, **go.mod `go 1.25.0`** — P0 C1 ⚠️ 해소, **빌드 이미지 `golang:1.25`**)
  - Postgres(자체, 5435) 스키마: `products`, `orders`, `wallets`, `auth_challenges` (CREATE IF NOT EXISTS + ALTER ADD COLUMN IF NOT EXISTS 패턴)
  - 지갑 인증: nonce→서명→JWT (cmall `wallet_auth.go` 복사, EIP-191 personal_sign, 원자적 single-use nonce, DEV_FAKE_SIGNATURE 3중 게이트: APP_ENV==dev + 플래그 + env 일치)
  - gateway 클라이언트: `gatewayURL()`(BLOCKCHAIN_GATEWAY_URL env) + `verifyWithGateway` + `paymentMatchesGateway`(amount_usdc int64 micro == AmountUsdc, payer 소문자 == WalletAddress 소문자) — cmall `payments.go` 복사
  - 주문 상태 enum: `pending → registered → paid → fulfilled(수동)`. **register 실패 시 pending 유지** (C9 신규)
  - **sync worker**: selling_dd products → shop_dd products upsert (주기 실행, DB 다운 시 무중단 재시도, 읽기전용 계정 SELECT)
  - JWT issuer `shop_dd`, fail-closed (jwtSecret/INTERNAL_API_KEY 미설정 시 부팅 거부)
- [ ] `web/` — React+Vite 프론트: 상품 목록/상세, 장바구니, 지갑 연결(MetaMask, **viem 2.21.55**), USDC approve→pay, 주문 상태
  - UI: 흰 상품박스 + 회색 연결버튼 (cmall_dd 컨벤션), 한국어
- [ ] **CI/CD: Jenkins + GitHub 웹훅 + Docker test-fix 루프** (사용자 확정)
  - `~/jenkins` 스택 기동 (docker compose -f jenkins/docker-compose.yml up -d, 최대 120s)
  - GitHub repo `sjh146/shop_dd` + 웹훅 `{tunnel-url}/github-webhook/` (re-register-webhook.sh 패턴)
  - Jenkins 파이프라인 `shop_dd-pipeline` (cmall_dd-pipeline Jenkinsfile 패턴): checkout → contracts test(hardhat, docker node) → backend test(go test, docker golang:1.25) → frontend build(vite) → compose config -q → 아티팩트 아카이브 → deleteDir
  - push → 자동 빌드 → 레드면 수정 커밋 → 그린까지 반복 (opencode가 test-fix 루프 수행)
- [ ] E2E: **on-chain 실결제 E2E (DEV_MOCK=false)** — 테스트 payer 지갑(에이전트 보관, /tmp, 비커밋)으로 register→approve→pay→verify. dev-mock은 register/verify 응답 형태 검증용 (P0 §5-5: dev-mock verify는 pay 무검증이라 실결제 대체 불가)
- [ ] Strix 보안 스캔 (스캔→수정→재스캔)
- [ ] 배포: docker-compose (shop-db, gateway-shop, shop-api, shop-web, nginx) + cloudflared

### Must NOT
- selling_dd Python 코드 import/서브프로세스 호출 (DB 싱크만)
- 메인넷/실 USDC/실체인 — Base Sepolia 테스트넷 + MockUSDC 한정
- 개인키/시크릿 커밋 (env 주입, `.env` gitignore; 테스트 payer 키는 /tmp)
- blockchain-gateway 코드 수정 (env 인스턴스만)
- gateway `execute` 엔드포인트 호출 (운영자 대납 금지 — P0 G9)
- `docker volume prune` 금지

## 데이터 계약 (selling_dd → shop_dd) — P0 §2 확정안

소스 실컬럼 (db/models.py): `id, keyword, title, price, description, image_url, source_url, market_urls(JSON), status, original_price, sale_price, discount_pct, margin_pct, volume, competition_score, raw_title, discount_hint_pct, created_at, updated_at`

| shop_dd 컬럼 | 타입 | 출처 | 변환 규칙 |
|---|---|---|---|
| id | SERIAL PK | 자체 | — |
| selling_product_id | INTEGER UNIQUE NOT NULL | products.id | upsert 키 `ON CONFLICT (selling_product_id)` |
| title | VARCHAR(500) | products.title | 그대로 |
| description | TEXT | products.description | 그대로 |
| image_url | VARCHAR(500) | products.image_url | 그대로 |
| source_url | VARCHAR(500) | products.source_url | 그대로 |
| sale_price_krw | INTEGER NULL | products.sale_price(USD str) | `int(float(usd)*1350)` → `round(/100)*100` (product_mapper.py:13-15 동일). 0/빈/파싱실패 → NULL |
| original_price_krw | INTEGER NULL | products.original_price | 동일 |
| margin_pct | VARCHAR(50) NULL | products.margin_pct | 그대로 |
| volume | INTEGER NULL | products.volume | 그대로 |
| status | VARCHAR(16) | 파생 | **listed = `status='manifest_ready' AND sale_price NOT IN ('0','','0.0') AND (sale_price)::numeric > 0`** (P0 D4 ⚠️: sale_price "0" 폴백 존재), 그외 unlisted |
| stock | INTEGER | — | 기본 1 |
| synced_at | TIMESTAMPTZ | 싱크 시각 | now |
| created_at/updated_at | TIMESTAMPTZ | 자체 | — |

싱크: `INSERT ... SELECT ... ON CONFLICT (selling_product_id) DO UPDATE`. 삭제는 soft(unlisted). 읽기전용 DB 계정(GRANT SELECT).

## gateway API 계약 — P0 §3 확정안

인증: 전 요청 `X-Internal-Api-Key` (fail-closed).

### register `POST /internal/blockchain/payment/register`
- 요청: `{"reference_id", "wallet_address", "amount_usdc"}` — **amount_usdc = micro USDC 정수 문자열 (1e6 배수, 6자리 소수)**
- 성공(온체인): 200 `{"ok":true,"tx_hash","order_id","mock":false}` — **order_id = BigInt(keccak256(toHex(reference_id))) 결정적** → 프론트 pay 인자로 전달 (P0 G3/§5-3)
- DEV_MOCK: `{"ok":true,"reference_id","mock":true,"already_registered":bool}`
- 오류: 400(필드 누락) / 501(OPERATOR_PRIVATE_KEY 없음) / 502(onchain fail)

### verify `POST /internal/blockchain/payment/verify`
- 요청: `{"reference_id"}`
- 성공(온체인): 200 `{"verified":bool,"order_id","chain_id":84532,"contract_address","payer","amount_usdc","tx_hash","mock":false}`
- payer/amount_usdc는 optional — **공백/미스매치 시 paid 승격 금지** (paymentMatchesGateway 대조: amount_usdc int64 == AmountUsdc, payer lower == wallet lower)

### execute — **호출 금지**. health: `GET /health` → `{"status":"ok"}`.

## 결제 흐름

1. 사용자: 상품 → 장바구니 → 주문 생성 `POST /api/orders` (지갑 JWT 필수) → DB `pending`, reference_id = DB order id 문자열
2. shop 백엔드 → gateway `register {reference_id, wallet_address, amount_usdc}` (KRW→USDC 환산: `round(krw/1350) * 1e6` micro) → gateway owner 서명 registerOrder → 응답 `order_id` 저장
3. 프론트: `wallet.approve(MockUSDC, ShopPayment, amount_micro)` → `wallet.pay(ShopPayment, order_id, amount_micro)` — **사용자 서명** (order_id는 register 응답에서, P0 §5-3)
4. 프론트 → `POST /api/orders/{id}/verify` → 백엔드 → gateway `verify {reference_id}` → `paymentMatchesGateway` 통과 시 `paid` 승격
5. 운영: paid 주문을 알리익스프레스 주문 접수 (수동, 후속 자동화) → `fulfilled`

금액 단위 통일 (P0 §5-4): DB int64 KRW 원단위 · gateway 전송 micro USDC (6자리) · KRW→USDC = `round(krw/1350)` USDC → ×1e6 micro. 프론트 표시는 KRW.

## 레포 구조

```
shop_dd/
├── PLAN.md / PLAN_v2
├── P0_ANALYSIS.md          # P0 산출물 (검증표)
├── TASK_P0.md
├── contracts/              # Hardhat CommonJS: ShopPayment.sol, MockUSDC.sol, deploy/, test/
├── server/                 # Go+Gin (go 1.25.0): main.go, internal/{handlers,models,database,sync,gatewayclient}/
├── web/                    # React+Vite: 상품/상세/장바구니/결제
├── deploy/                 # docker-compose.yml, nginx.conf, Jenkinsfile, .env.example
├── scripts/                # re-register-webhook.sh, e2e-*.sh
└── tests/                  # E2E 스크립트
```

## 절차 (opencode 단계별 실행, 각 단계 Jenkins 게이트)

| 단계 | 내용 | 게이트 |
|---|---|---|
| P0 | ✅ 심층분석 완료 (opencode Prometheus) → P0_ANALYSIS.md | ✅ Hermes gate 통과 → v2 |
| P1 | Jenkins 기동(~/jenkins) + shop_dd 파이프라인 + GitHub 웹훅 (test-fix 루프 인프라) | Jenkins 빌드 그린 (placeholder) |
| P2 | contracts: ShopPayment/MockUSDC + hardhat 테스트 + Base Sepolia 배포 + 온체인 검증 | hardhat 그린 + 온체인 증거 |
| P3 | gateway shop 인스턴스(8091) + register→approve→pay→verify **on-chain E2E** (테스트 payer) | E2E 로그 + verify verified=true |
| P4 | 백엔드: DB/인증/상품/주문/sync worker + dev-mock 결제 E2E | go test 그린 + E2E |
| P5 | 프론트: 목록/상세/장바구니/지갑결제 (dev-mock 체인) | 빌드 그린 |
| P6 | Strix 스캔 → 수정 → 재스캔, docker-compose 배포 + cloudflared, 웹훅 재등록 | 스캔 클린 + 배포 스모크 |

## 리스크 & 함정 (P0 실측 반영)

1. **golang:1.25** 필수 (cmall go.mod `go 1.25.0` — 1.21 빌드 실패)
2. **PaymentSettled `treasury(indexed)`** — ShopPayment 이벤트 시그니처 100% 일치 (불일치 시 txHash 미추출)
3. **order_id = keccak256(toHex(reference_id))** — 프론트 pay 인자, register 응답에서 전달
4. **amount 단위**: gateway는 BigInt 그대로 (환산 없음) → shop이 micro 정수 문자열로
5. **sale_price "0" 폴백** — listed 필터 제외
6. **dev-mock verify는 pay 무검증** (즉시 verified) → 실결제는 DEV_MOCK=false on-chain E2E로만 증명
7. Base Sepolia RPC `eth_getLogs` 10,000블록 제한 → 상태 기반 검증 (processedOrderIds/orderPayer/orderAmount 멀티콜, paymentVerifier.ts:141-178)
8. Base Sepolia USDC 없음 → MockUSDC(6자리) 직접 배포 (무제한 민트 = 테스트넷 faucet 대체)
9. Base Sepolia ETH 펀딩: L1 faucet ETH는 L2 가스로 못 씀 — 브리지 필수 (L2StandardBridge 0x4200...0010, `l1TokenBridge()` eth_call로 실제 주소 조회)
10. viem 2.21.55 + TS 5.6.3 고정, hardhat config CommonJS `.js`
11. pay() 직후 processedOrderIds false 가능 (RPC 인덱싱 지연) — 재조회
12. Go 미설치(호스트) → Docker 빌드 (`docker run --rm -v $PWD:/app -w /app golang:1.25 bash -c "go build ./... && go vet ./... && go test ./..."`)
13. Hermes 터미널 가드: docker compose up은 background=true, 빌드/검증/기동 분리
14. Jenkins 터널 URL 변경 시 웹훅 재등록 필요
15. opencode 산출물 자기보고 불신 — 파일 존재/내용/테스트 출력 직접 검증

## 사용자 확정 사항
- "계획 심층분석까지하고 Jenkins, git웹훅, 도커를 이용해서 테스트 수정을 반복해줘" → P0 완료 후 **Jenkins+웹훅+Docker test-fix 루프**로 구현 진행
- "shop_dd 웹사이트 디자인할때 AI티 안나고 사람이 디자인한 것 같은 느낌" (2026-08-17) → 아래 **디자인 가이드** 강제

## 디자인 가이드 (P5 프론트 필수 — AI 티 금지)

### 금지 (AI 티)
- 보라/블루 그라데이션 히어로, 글래스모피즘, 네온, 다크+골드 클리셰
- UI 카피에 이모티콘/✨, "혁신적인", "초특가!" 류 마케팅 문체
- Inter/시스템 폰트 기본값, 플레이스홀더 대문자, Lorem ipsum
- 완벽 대칭 강박, 스톡사진, "AI가 추천한" 류 문구

### 적용 (사람 느낌)
- **색**: 크림/화이트 배경(#FAF9F6 계열) + 차콜 텍스트(#2A2A28) + 브라스/앰버 포인트(#B8860B 계열). 검은 배경 금지.
- **타이포**: 헤딩 Noto Serif KR(무게감) + 바디 고딕(Noto Sans KR/Pretendard), 가격은 숫자 폰트(탭 정렬)
- **카피**: 실제 점주 톤 — 구체적·정직: "알리익스프레스 직배송, 평균 2~3주", "USDC 결제는 수수료가 없어요", "테스트넷 상점입니다 — 실결제 아님" (명시)
- **상품 카드**: 흰 박스 + 실사 이미지(알리 원본 URL) + 손으로 붙인 듯한 할인 태그, 원가/판매가/할인율을 표로 정직하게
- **결제 UX**: "결제 수단: USDC"는 조용한 안내 문구(푸터/주문 단계), 크립토 락 띄우지 않기. 지갑 연결 버튼은 회색(카말 컨벤션)
- **디테일**: 카드 호버 살짝 상승, 일관된 여백 리듬, 한국어 전용
