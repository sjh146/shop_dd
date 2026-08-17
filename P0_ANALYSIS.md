# P0 분석산출물 — shop_dd PLAN v1 실측검증 (2026-08-17)

> **목적**: `TASK_P0.md`의 요구 산출물 `P0_ANALYSIS.md`(repo 루트) 내용. 이 파일은 플랜-모드 가드가 `.omo/` 외 쓰기를 차단하여 내용을 안전하게 보존해 둔 사본이다.
> **최종 배치**: `/home/dduckbeagy/shop_dd/P0_ANALYSIS.md` (실행 작업자가 `$start-work` 후 이 내용을 복사/생성해야 함. `wc -c`로 크기 확인 예정).
> 작성: opencode Prometheus · 기준: `PLAN.md` · 실측: `selling_dd` / `blockchain-gateway` / `cmall_dd` · .env 시크릿 미읽음.
> **결론**: 조건부 GO.

---

## 1. 검증표 — PLAN 가정 vs 코드 실측

### 1.1 데이터 계약 (selling_dd → shop_dd)

| # | PLAN 가정 | 코드 실측 (selling_dd) | 판정 | v2 수정 제안 |
|---|---|---|---|---|
| D1 | products 컬럼: `id, keyword, title, price, description, image_url, source_url, status, original_price, sale_price, discount_pct, margin_pct, volume, competition_score, raw_title, created_at, updated_at` | `db/models.py:7-27` Product: `id(Integer PK), keyword, title, price, description, image_url, source_url, market_urls(JSON), status, original_price, sale_price, discount_pct, margin_pct, volume(Integer), competition_score, raw_title, discount_hint_pct, created_at, updated_at` | ✅ (거의 일치) | PLAN 목록에 **`market_urls(JSON)` 와 `discount_hint_pct` 가 누락**됨. shop_dd로 싱크 안 해도 되나, upsert SELECT는 실존 컬럼만. `price`도 존재(발견용, 싱크 제외 가능). |
| D2 | `sale_price`/`original_price`는 **USD 문자열**, KRW 변환 고정 1350 | `db/models.py:18-19`: `sale_price=String(100)`, `original_price=String(100)` — 문자열. `product_mapper.py:8` `USD_TO_KRW_RATE=1350.0`, `:13-15` `int(float(usd)*1350)` 후 `round(krw/100)*100` | ✅ | 환율 1350 실일치. 변환에 100원 단위 반올림 포함. 원본 환산 재현 위해 `int(float(usd)*1350)→round(/100)*100` 통일. |
| D3 | `convert_usd_to_krw` 존재 | `product_mapper.py:10` `def convert_usd_to_krw(usd: str\|float\|int)->str` — 존재, `str` 반환(콤마+원). ⚠️ 테스트 미존재(codegraph) | ✅ (존재) | 반환 `₩17,000` str이므로 DB INTEGER는 `int(float(usd)*1350)`로 직접 계산. str 파싱 금지. |
| D4 | status `'manifest_ready'` 이 'listed' 전제 | `manifest_builder.py:149` `status="manifest_ready"`. `:49` `sale_price=deal.get(...,"0")`. `:133-150` manifest 유무만 검사, sale_price 유효성 미검사 후 무조건 manifest_ready | ⚠️ | **"0" 문자열 누락**. listed 조건에 `sale_price NOT IN('0','','0.0') AND (sale_price)::numeric>0` 필수. |
| D5 | DB 연결 SQLAlchemy | `pyproject.toml:12-13` sqlalchemy>=2.0.50 + psycopg2-binary>=2.9.12. `db/__init__.py:8-11` create_engine+SessionLocal. `settings.py:26` DATABASE_URL 기본 `postgresql://selling_dd:selling_dd_pass@localhost:5432/selling_dd` | ✅ | shop 싱크 워커는 SQLAlchemy 불필요, Go `database/sql`+`lib/pq`로 SELECT만. |
| D6 | localhost:5432 | `docker-compose.yml:9-10` 5432:5432, DB selling_dd/컨테이너 selling_dd_db | ✅ (설계상) | 기동 여부는 P1 시작 시 `pg_isready -h localhost -p 5432`/`docker compose ps`로 확인(본 분석은 라이브 프로브 미지원). 싱크 워커는 DB 다운 무중단 재시도. |
| D7 | soft delete = 'unlisted' | 소스엔 'sourced'/'manifest_ready'만 | ✅ (신규) | shop status는 자체 공개여부 개념으로 독립. manifest_ready→listed, 그외→unlisted. |

### 1.2 gateway API 계약

| # | PLAN 가정 | 코드 실측 (blockchain-gateway) | 판정 | v2 수정 제안 |
|---|---|---|---|---|
| G1 | register 요청 `{reference_id, wallet_address, amount_usdc}` | `server.ts:138-155`: 3필수, 누락 400. DEV_MOCK 저장 | ✅ | `amount_usdc`는 `BigInt(amountUsdc)`(server.ts:173)로 **gateway 환산 없음** → shop은 **마이크로(1e6) USDC 정수 문자열** |
| G2 | registerOrder owner 서명 | `server.ts:157-185` operator 키로 writeContract | ✅ | operator 지갑 = ShopPayment **owner**여야 onlyOwner 성공 |
| G3 | verify 응답 `{verified, tx_hash, order_id, payer, amount_usdc, chain_id}` | `server.ts:219-238` + contract_address. `paymentVerifier.ts:81-90` | ✅ | 실키: `verified,tx_hash,order_id,payer,amount_usdc,chain_id,contract_address,mock`. payer/amount optional → 미스매치 시 paid 금지 |
| G4 | 상태 기반, 로그 latest-10000 | `paymentVerifier.ts:141-178` processedOrderIds→multicall→getLogs(latestBlock-9000) | ✅ | PLAN 리스크 일치 |
| G5 | ShopPayment = **AnalyistPayment 동일 ABI** | gateway ABI: registerOrder/pay/processedOrderIds/orderAmount/orderPayer + 이벤트 `PaymentSettled(uint256 indexed orderId,address indexed payer,uint256 amountUsdc,address indexed treasury)` (paymentVerifier.ts:40-49) | ⚠️ | **이벤트에 `treasury(indexed)` 존재**. 미일치 시 txHash 미추출. v2에서 시그니처 100% 일치(toKey treasury 포함) |
| G6 | gateway 미수정 + env 인스턴스만으로 shop 서빙 | `config.ts:37-49`: INTERNAL_API_KEY 필수(fail-closed), PORT/DEV_MOCK/OPERATOR/*주소/CHAIN_ID. baseSepolia 하드코딩(paymentVerifier.ts:109) | ✅ 가능 | port 8091 + ShopPayment/MockUSDC 주소 + 별도 INTERNAL_API_KEY + DEV_MOCK=false |
| G7 | viem 2.21.55 + ts 5.6.3 고정 | `package.json:18,24` | ✅ | 프론트 viem도 동일 버전 권장 |
| G8 | dev-mock E2E | `devMock.ts:18-44` verifyMockPayment 즉시 verified | ✅ (dev) | dev-mock은 pay 행위 무검증. 실결제는 DEV_MOCK=false E2E 필수 |
| G9 | execute 미사용 | `server.ts:243-322` pay가 payer=operator 강제 | ✅ | execute 금지 유지. 테스트 payer 실결제는 프론트가 테스트 지갑 서명(사설키 env 주입, 비커밋) |

### 1.3 Go 백엔드 패턴 (cmall_dd)

| # | PLAN 가정 | 코드 실측 (cmall_dd/server) | 판정 | v2 수정 제안 |
|---|---|---|---|---|
| C1 | Gin+Postgres+database/sql | `server/go.mod`(루트 아님): **`go 1.25.0`**, gin v1.12.0, lib/pq, jwt/v5, go-ethereum v1.17.5. `database.go:12-56` InitDB=`sql.Open`+Ping | ⚠️ | **`golang:1.21` 빌드 불가**. `golang:1.25`(또는 1.24+)로 |
| C2 | nonce→서명→JWT | `wallet_auth.go:64-183` WalletNonce(32B nonce, TTL 5분)+WalletVerify(원자적 single-use consume→서명→upsert→JWT) | ✅ | 복사. 원자적 consume 유지. EIP-191 personal_sign |
| C3 | DEV_FAKE_SIGNATURE dev | `wallet_auth.go:239-258` devSignatureOK: APP_ENV=="dev"+플래그+env(DEV_FAKE_SIGNATURE)일치만, fail-closed | ✅ | 동일 3조건 게이트 |
| C4 | `BLOCKCHAIN_GATEWAY_URL`+키 | `payments.go:30-47` gatewayURL()+verify POST+X-Internal-Api-Key+Timeout 10s | ✅ | 복사 |
| C5 | `paymentMatchesGateway` | `payments.go:70-88` amount_usdc(int64)==AmountUsdc, payer(lower)==WalletAddress(lower) | ✅ | wallet_address **소문자 저장**. AmountUsdc int64=micro |
| C6 | JWT 미들웨어 | `middleware.go:12-84` Auth/Optional + helpers.go jwtSecret(fail-closed), 7일, issuer cmall_dd | ✅ | issuer `shop_dd` |
| C7 | idempotent 스키마 | `database.go:58-397` CREATE IF NOT EXISTS + ALTER ADD COLUMN IF NOT EXISTS | ✅ | products/orders/wallets/auth_challenges. pgvector 생략 가능 |
| C8 | main 라우트/PORT | `main.go:16-160` godotenv→InitDB→CreateTables→gin→r.Run(:port(기본 8080)), protected 그룹 | ✅ | 주문/verify protected |
| C9 | `pending→registered→paid→fulfilled` | cmall은 pending/paid 2단계만(`payments.go:26-27`) | ⚠️ | **`registered`는 신규**. v2에 enum+register 실패 시 pending 유지 정책 명시 |

---

## 2. 데이터 계약 최종안 (selling_dd.products → shop_dd.products)

소스 실컬럼: `id, keyword, title, price, description, image_url, source_url, market_urls(JSON), status, original_price, sale_price, discount_pct, margin_pct, volume, competition_score, raw_title, discount_hint_pct, created_at, updated_at`

| shop_dd 컬럼 | 타입 | 출처 | 변환 규칙 |
|---|---|---|---|
| id | SERIAL PK | 자체 | — |
| selling_product_id | INTEGER UNIQUE NOT NULL | products.id | upsert 키 `ON CONFLICT (selling_product_id)` |
| title | VARCHAR(500) | products.title | 그대로 |
| description | TEXT | products.description | 그대로 |
| image_url | VARCHAR(500) | products.image_url | 그대로 |
| source_url | VARCHAR(500) | products.source_url | 그대로 |
| sale_price_krw | INTEGER | products.sale_price(USD str) | `int(float(sp)*1350)`→`round(/100)*100`. 0/빈/파싱실패→NULL |
| original_price_krw | INTEGER NULL | products.original_price | 동일 |
| margin_pct | VARCHAR(50) NULL | products.margin_pct | 그대로(문자열) |
| volume | INTEGER NULL | products.volume | 그대로 |
| status | VARCHAR(16) | 파생 | listed = `status='manifest_ready' AND sale_price 유효(>0)`, 그외 unlisted |
| stock | INTEGER | — | 기본 1 |
| synced_at | TIMESTAMPTZ | 싱크 시각 | now |
| created_at/updated_at | TIMESTAMPTZ | 자체 | — |

싱크: `INSERT ... SELECT ... ON CONFLICT (selling_product_id) DO UPDATE`. 삭제는 soft(unlisted). 읽기전용 계정(GRAINT SELECT).

---

## 3. gateway API 계약 최종안

인증: 전 요청 `X-Internal-Api-Key`(server.ts:94-104). base `PORT=8091`.

### register (POST /internal/blockchain/payment/register)
- 요청: `{"reference_id", "wallet_address", "amount_usdc"}` (amount_usdc micro USDC str)
- 성공(온체인): 200 `{"ok":true,"tx_hash","order_id","mock":false}` → order_id=`BigInt(keccak256(toHex(reference_id)))`
- DEV_MOCK: `{"ok":true,"reference_id","mock":true,"already_registered":bool}`
- 오류: 400/501(키 없음)/502(onchain fail)

### verify (POST /internal/blockchain/payment/verify)
- 요청: `{"reference_id"}`
- 성공(온체인): 200 `{"verified":bool,"order_id","chain_id":84532,"contract_address","payer","amount_usdc","tx_hash","mock":false}`
- payer/amount optional → 미스매치/공백 시 paid 금지. `paymentMatchesGateway`로 대조.
- DEV_MOCK: 즉시 verified.

### execute — **호출 금지**(운영자 대납). health: `{"status":"ok"}`.

---

## 4. Go 재사용 패턴 목록 (cmall_dd → shop_dd 복사)

wallet_auth.go(WalletNonce/Verify, recoverAddress, devSignatureOK), middleware.go(Auth/Optional), helpers.go(jwtSecret/signClaims/internalKey), payments.go(gatewayURL/verifyWithGateway/paymentMatchesGateway), payments 흐름(CreatePayment→orders 기준 재작성), database.go(InitDB/CreateTables), models.go(Payment/Product), main.go(부팅+라우트), cart.go(장바구니 참조), products.go(목록/상세+sanitizePublicProduct), Dockerfile/compose/nginx.conf/Jenkinsfile.

---

## 5. 리스크/함정 추가분

1. **golang:1.21 빌드 실패**(높음) → golang:1.25
2. **PaymentSettled `treasury` 필드**(중) → 시그니처 일치 필수
3. **orderId 계산**(중) → `keccak256(toHex(reference_id))`을 프론트 pay에 노출
4. **amount 단위**(중) → round(krw/1350)×1e6 micro 통일
5. **dev-mock verify 비현실적**(중) → 실결제는 on-chain E2E
6. **sale_price "0"**(낮음) → listed 필터 제외
7. **JWT/nonce 인코딩**(중) → EIP-191 동일 유지
8. **selling_dd DB 라이브 미확인**(중) → P1 시작 시 pg_isready
9. **별도 INTERNAL_API_KEY**(중)
10. **go.mod 위치**(낮음) → server/go.mod

---

## 6. v2 필수 변경 (우선순위)

1. Go 빌드 이미지 `golang:1.25`
2. ShopPayment `PaymentSettled` 이벤트 시그니처(treasury 포함)를 gateway ABI와 일치
3. register 응답 `order_id` 프론트 전달 흐름 명시
4. `amount_usdc` 마이크로 + KRW→USDC 환산 정식화
5. listed 필터에 sale_price "0" 제외
6. (권장) dev-mock vs on-chain E2E 분리

---

## 7. 결론 — **조건부 GO**

데이터/API/결제 계약 3중대 실코드 일치. gateway env 인스턴스로 shop 서빙 가능. Go 패턴 재사용 가능. §6 조건(①golang:1.25 ②이벤트 시그니처 ③order_id 전달 ④micro 환산 ⑤sale_price "0") 지키면 P1~P6 진행 가능.
