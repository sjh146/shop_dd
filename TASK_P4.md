# P4 태스크 — Go+Gin 백엔드 (opencode Atlas)

질문하지 말고 끝까지 진행해. 완료 후 커밋/푸시 (Jenkins 자동 빌드).

## 배경
`~/shop_dd/PLAN.md` §P4 + `P0_ANALYSIS.md` §1.3/§2/§3 읽어라.
- gateway shop 인스턴스 8091 가동 중 (P3): `SHOP_GATEWAY_URL=http://localhost:8091`, 키=`~/.hermes/secrets/shop_gateway_key.txt`
- 컨트랙트: ShopPayment `0x7fD9208e601c69639F6875EC24717e8476A2cCb1`, MockUSDC `0xe0661BAff428a1d57cb717E5Ce15Deca4F847E90` (Base Sepolia)
- **Go 백엔드는 cmall_dd에서 복사-개조** (자기 스택 재발명 금지): `~/cmall_dd/server/`의 wallet_auth.go / payments.go / middleware.go / helpers.go / database.go / models.go / main.go / cart.go / products.go
- cmall 의존성: gin v1.12.0, go-ethereum v1.17.5, golang-jwt/v5 v5.3.1, lib/pq v1.10.9, **go 1.25.0**
- 호스트에 Go 없음 → 빌드/테스트는 Docker `golang:1.25`

## 시크릿 규칙
- INTERNAL_API_KEY 값 출력/커밋 금지 — `~/.hermes/secrets/shop_gateway_key.txt` 참조. `.env`는 gitignore 대상.

## 1. `~/shop_dd/server/` 생성 (Go module `shop-dd`)
```
server/
├── go.mod (go 1.25.0)
├── main.go            # godotenv → InitDB → CreateTables → Gin 라우트 → :8095
├── Dockerfile         # golang:1.25 빌드 → distroless/alpine 실행 (8095)
├── Dockerfile.ci      # golang:1.25, COPY . → go build && go vet && go test (Jenkins용)
└── internal/
    ├── database/database.go   # InitDB(Postgres 5435) + CreateTables(멱등: CREATE IF NOT EXISTS + ALTER ADD COLUMN IF NOT EXISTS)
    ├── models/models.go       # User, Product, Order (+OrderItem)
    ├── handlers/wallet_auth.go  # nonce→서명→JWT (EIP-191 personal_sign, 원자적 single-use nonce 5분 TTL)
    ├── handlers/middleware.go    # Auth/Optional JWT (issuer=shop_dd)
    ├── handlers/helpers.go       # jwtSecret fail-closed, 응답 헬퍼
    ├── handlers/products.go      # GET /api/products (listed만, KRW 표시), GET /api/products/:id
    ├── handlers/orders.go        # POST /api/orders, POST /api/orders/:id/verify, GET /api/orders, GET /api/orders/:id
    ├── handlers/payments.go      # gateway client (register/verify + X-Internal-Api-Key + timeout), paymentMatchesGateway
    └── sync/sync.go              # 싱크 워커
```

### DB 스키마 (CreateTables 멱등)
- `users`: id SERIAL PK, email VARCHAR UNIQUE (`<wallet>@wallet.local`), password TEXT(랜덤 bcrypt, 로그인 불가), name, role DEFAULT 'buyer', is_wallet_user BOOLEAN DEFAULT false, created_at/updated_at
  - **Register는 `@wallet.local` 도메인 400 거부** (스쿼팅 방지, cmall 하드닝 계승)
  - 지갑 프로비저닝: INSERT ON CONFLICT(email) DO UPDATE (cmall 패턴 그대로)
- `auth_challenges`: nonce VARCHAR PK, wallet_address, challenge_type DEFAULT 'wallet', used_at TIMESTAMPTZ NULL, expires_at
- `products`: id SERIAL PK, selling_product_id INTEGER UNIQUE, title VARCHAR(500), description TEXT, image_url VARCHAR(500), source_url VARCHAR(500), sale_price_krw INTEGER NULL, original_price_krw INTEGER NULL, margin_pct VARCHAR(50), volume INTEGER, status VARCHAR(16) ('listed'/'unlisted'), stock INTEGER DEFAULT 1, synced_at TIMESTAMPTZ, created_at/updated_at
- `orders`: id SERIAL PK (=reference_id), user_id INTEGER, wallet_address VARCHAR(42), status VARCHAR(16) ('pending'/'registered'/'paid'/'fulfilled'/'cancelled'), total_krw INTEGER, total_usdc_micro BIGINT, gateway_order_id VARCHAR(80) NULL, tx_hash VARCHAR(80) NULL, created_at/updated_at
- `order_items`: id, order_id FK, product_id FK, title, price_krw, qty

### 핵심 로직
- **KRW→USDC**: `micro = round(total_krw / 1350.0) * 1_000_000` (P0 §3) — `internal/...` 헬퍼 + 단위 테스트
- **주문 생성** `POST /api/orders` (JWT): items 검증(재고/listed) → total_krw 계산 → order 생성(status=pending) → **gateway register** `{reference_id: order_id(문자열), wallet_address: JWT 지갑, amount_usdc: micro 문자열}` → 성공 시 status=registered + gateway_order_id 저장, 실패 시 pending 유지 (무중단 원칙) → 응답에 `{order_id, amount_usdc_micro, gateway_order_id, contract_address: ShopPayment, usdc_token: MockUSDC}` (프론트 pay용)
- **verify** `POST /api/orders/:id/verify` (JWT, 소유자): gateway verify → `paymentMatchesGateway`(payer 소문자==지갑, amount_usdc==total_usdc_micro) 통과 시 status=paid + tx_hash 저장
- **싱크 워커** (ticker 5분 + 시작 시 1회): selling_dd Postgres(5432, 읽기전용 계정 `shop_sync`) `products` SELECT → 변환(P0 §2: KRW 변환 `int(float(usd)*1350)`→`round(/100)*100`, listed = status='manifest_ready' AND sale_price 유효>0) → `INSERT ... ON CONFLICT (selling_product_id) DO UPDATE` upsert, 삭제는 soft(unlisted). **DB 다운 시 로그+재시도, API 무중단**
- DEV_FAKE_SIGNATURE: cmall 3중 게이트 그대로 (APP_ENV=="dev" + DEV_FAKE_SIGNATURE env 일치)

## 2. Postgres (shop_dd 자체, 5435)
```
docker rm -f shop-postgres 2>/dev/null; docker run -d --name shop-postgres --restart unless-stopped \
  -p 5435:5432 -e POSTGRES_DB=shop_dd -e POSTGRES_USER=shop_dd -e POSTGRES_PASSWORD=$(openssl rand -hex 16) postgres:16-alpine
```
- 비밀번호는 `~/.hermes/secrets/shop_db_pw.txt`에 저장, 출력 금지. `.env`: `DB_HOST=localhost DB_PORT=5435 DB_USER=shop_dd DB_PASSWORD=<값> DB_NAME=shop_dd APP_ENV=dev DEV_FAKE_SIGNATURE=0xdev BLOCKCHAIN_GATEWAY_URL=http://localhost:8091 INTERNAL_API_KEY=<gateway 키>`
- `SELLING_DB_URL` env: `postgresql://selling_dd:<selling_dd pw>@localhost:5432/selling_dd` (selling_dd 기본 비밀번호는 `~/selling_dd/docker-compose.yml`의 POSTGRES_PASSWORD 값 — 그걸로)

## 3. 테스트 (`go test ./...` — Docker로 실행, DB 불필요 유닛 우선)
1. KRW→USDC 환산 (round/마이크로)
2. paymentMatchesGateway (payer 소문자/amount 매칭, 미스매치 거부)
3. nonce 생성/검증 (TTL, single-use 원자성은 DB 테스트로 분리)
4. listed 필터 로직 (sale_price "0"/빈 값 제외)
5. 지갑 서명 검증 (EIP-191, viem으로 서명한 테스트 벡터 — cmall 테스트 패턴)
6. 핸들러: products 목록 (httptest + 모의 DB 또는 인터페이스), orders 생성 (gateway 클라이언트를 인터페이스로 모킹)
- DB 통합 테스트는 `TEST_DB_URL` 설정 시에만 실행 (CI는 스킵) — cmall 패턴

## 4. 싱크 E2E (실증)
- selling_dd postgres 기동: `cd ~/selling_dd && docker compose up -d postgres` (볼륨 보존 — 기존 products 데이터 복원됨)
- selling_dd DB에 상품 없으면 샘플 2건 INSERT (status='manifest_ready', sale_price 유효 1건 + sale_price='0' 1건 → listed/unlisted 검증)
- 싱크 워커 1회 실행 → shop_dd products 확인: listed 1건 (KRW 환산 값 확인), unlisted 1건
- `SELECT title, sale_price_krw, status FROM products;` 출력 (증거)

## 5. 백엔드 통합 E2E (P3 테스트 payer 재사용, /tmp/shop_e2e_payer.key 없으면 새로)
`tests/e2e-backend.cjs` (viem, NODE_PATH=~/blockchain-gateway/node_modules):
1. 지갑 인증: nonce→(0xdev dev 서명)→JWT (APP_ENV=dev 체인)
2. 상품 목록 GET → listed 상품 1개 확인
3. 주문 생성 POST /api/orders → status=registered + gateway_order_id
4. payer(테스트 지갑): MockUSDC mint(자기 주소로) + approve + pay(gateway_order_id, amount_usdc_micro) — 온체인
5. POST /api/orders/:id/verify → status=paid + tx_hash
6. 결과 출력 → `.omo/evidence/p4-backend-e2e.txt`

## 6. Jenkinsfile에 backend_test 스테이지 추가
- `server/Dockerfile.ci` (golang:1.25, COPY ., `go build ./... && go vet ./... && go test ./...`  — 도커 빌드 실패 exit code 확인: `docker build` 단독 실행, `| tail` 금지)
- 스테이지: `sh 'docker build -f server/Dockerfile.ci -t shop-server-ci . && docker run --rm shop-server-ci'` (workdir=repo 루트)

## 완료 게이트
- go build/vet/test 그린 (Docker) · 싱크 E2E 증거 · 백엔드 통합 E2E paid 확인 · Jenkins 빌드 그린
- 커밋: `"P4: Go 백엔드 (인증/상품/주문/싱크)"` + push. 마지막에 요약 출력 (테스트 수, E2E 결과, 상품 KRW 값)
