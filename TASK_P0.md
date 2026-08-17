# P0 심층분석 태스크 (opencode Prometheus - Plan Builder)

구현 금지, 분석만. 질문하지 말고 끝까지 진행해.

## 중요 제약
- **어떤 `.env` 파일도 읽지 마라** (시크릿 — `~/blockchain-gateway/deploy/.env`, `~/selling_dd/.env`, `~/cmall_dd/.env` 등). 아래 "사전 제공 자료"로 충분하다. .env가 필요해 보여도 스킵하고 코드 기반으로 판단하라.

## 사전 제공 자료 (이미 확보됨 — 파일 읽지 말 것)

### gateway deploy/docker-compose.yml (요약)
- 통합 compose `name: cmall-protocol`: 서비스 `blockchain-gateway`(build context `..` = blockchain-gateway repo, ports 8090:8090, env_file .env, 환경: DEV_MOCK/INTERNAL_API_KEY/RPC_URL=https://sepolia.base.org/CHAIN_ID=84532/PAYMENT_CONTRACT_ADDRESS/USDC_TOKEN_ADDRESS, 네트워크 blockchain, healthcheck /health), `cmall-api`(build ../../cmall_dd), `analyist-api`, `postgres`(pgvector:pg16), `redis`, `nginx`(80/443). 네트워크: edge/app/blockchain. 볼륨: cmall_pgdata.

### gateway .env.example + .env.shared.example (템플릿 — 값 아님)
- env 변수 목록: `PORT=8090`, `INTERNAL_API_KEY`, `DEV_MOCK`, `RPC_URL=https://sepolia.base.org`, `CHAIN_ID=84532`, `PAYMENT_CONTRACT_ADDRESS`, `USDC_TOKEN_ADDRESS`, `OPERATOR_PRIVATE_KEY`, `ZKPASSPORT_SCOPE`, `SUBSCRIPTION_CONTRACT_ADDRESS`.

### selling_dd .env.example (템플릿)
- `DEEPSEEK_API_KEY/BASE_URL/MODEL`, `DATABASE_URL=postgresql://selling_dd:***@localhost:5432/selling_dd`

## 1. PLAN 읽기
`/home/dduckbeagy/shop_dd/PLAN.md` 전체를 주의 깊게 읽어라.

## 2. 실코드 대조 (3개 코드베이스)
1. `~/selling_dd` — 데이터 계약 검증:
   - `db/models.py` (Product 스키마: 실제 컬럼/타입)
   - `config/settings.py` (DATABASE_URL 기본값)
   - `agents/manifest_builder.py` (상태값 'manifest_ready' 실제 사용)
   - `agents/aliexpress_agent/product_mapper.py` (convert_usd_to_krw 존재/시그니처/환율)
   - DB 연결 방식 (SQLAlchemy? psycopg2?) 및 현재 기동 여부 (localhost:5432)
2. `~/blockchain-gateway` — API 계약 검증:
   - `src/server.ts` (register/verify/execute 요청·응답 필드, X-Internal-Api-Key 인증)
   - `src/lib/paymentVerifier.ts` (computeOrderId, verifyPayment 반환 필드)
   - `src/config.ts` (env 목록), `package.json` (viem 버전, 스크립트), `src/lib/devMock.ts`
   - `deploy/docker-compose.yml` (기동 방식/포트)
   - 결론: gateway **코드를 수정하지 않고** env 인스턴스만으로 shop_dd를 서빙 가능한가?
3. `~/cmall_dd` — Go 패턴 검증:
   - `server/internal/handlers/wallet_auth.go` (nonce→서명→JWT, DEV_FAKE_SIGNATURE)
   - `server/internal/handlers/payments.go` (gateway 클라이언트, paymentMatchesGateway)
   - `server/internal/handlers/cart.go`, `products.go`, `middleware.go`, `database.go`, `models.go`
   - `server/main.go` (라우트 등록), `go.mod` (Go 버전/의존성)

## 3. 산출물: `/home/dduckbeagy/shop_dd/P0_ANALYSIS.md` (한국어)
- 섹션별 검증표: `PLAN 가정 | 코드 실측(파일:라인, 실제 값) | 일치 ✅/⚠️/❌ | v2 수정 제안`
- 데이터 계약 최종안 (selling_dd.products 실제 컬럼 → shop_dd.products 매핑)
- gateway API 계약 최종안 (요청/응답 JSON 스키마, 실제 필드명)
- Go 백엔드 재사용 패턴 목록 (cmall_dd에서 복사할 파일/함수명)
- 리스크/함정 추가분 (PLAN.md에 없는 것)
- v2에서 반드시 바꿔야 할 것 3-5개 (우선순위)
- 결론: PLAN v1 실행 가능성 판정 (GO/NG/조건부)

## 4. 완료 확인
- P0_ANALYSIS.md가 실제 생성됐는지 확인하고 `wc -c /home/dduckbeagy/shop_dd/P0_ANALYSIS.md` 출력
