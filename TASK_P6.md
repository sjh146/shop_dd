# P6a 태스크 — 통합 배포 (docker-compose + cloudflared) (opencode Atlas)

질문하지 말고 끝까지 진행해. 완료 후 커밋/푸시.

## 배경
`~/shop_dd/PLAN.md` §P6 읽어라. P2-P5 완료 상태:
- 컨트랙트: ShopPayment `0x7fD9208e601c69639F6875EC24717e8476A2cCb1` + MockUSDC `0xe0661BAff428a1d57cb717E5Ce15Deca4F847E90` (Base Sepolia)
- gateway 이미지: `blockchain-gateway:shop` 빌드됨 (docker run shop-gateway 8091로 현재 실행 중)
- 백엔드: `~/shop_dd/server/` (Go+Gin, :8095, Dockerfile/Dockerfile.ci 있음) — 현재 호스트 바이너리로 실행 중 (이걸 compose로 대체)
- 프론트: `~/shop_dd/web/` (Vite+React, Dockerfile.ci 있음 — **프로덕션용 Dockerfile 없음, 이번에 작성**)
- 참고 패턴: `~/cmall_dd/docker-compose.yml` + nginx (프론트 정적 서빙 + /api 프록시)

## 시크릿 규칙
- `~/.hermes/secrets/shop_gateway_key.txt`(INTERNAL_API_KEY), `~/.hermes/secrets/shop_db_pw.txt`(DB 비번), `~/contracts/.env`(OPERATOR_PRIVATE_KEY) 참조. 값 출력/커밋 금지.
- `deploy/.env`는 gitignore + 600. `.env.example`만 커밋.

## 1. `web/Dockerfile` (프로덕션 — multi-stage)
- stage1: `node:22-alpine` — COPY package*.json → npm ci → COPY . → npm run build (dist 생성)
- stage2: `nginx:alpine` — dist 복사 + nginx.conf (SPA fallback: try_files $uri /index.html; `/api/` → `http://shop-api:8095` 프록시, `X-Internal-Api-Key`는 백엔드가 직접 검증하므로 nginx는 전달만)
- nginx.conf: gzip, 캐시 헤더(정적 에셋), listen 80

## 2. `deploy/docker-compose.yml` (`~/shop_dd/deploy/`)
서비스:
- `shop-postgres`: postgres:16-alpine, 내부망 전용(포트 미노출), 볼륨 `shop_pgdata`, env POSTGRES_DB=shop_dd/USER=shop_dd/PASSWORD
- `gateway-shop`: build context `../../blockchain-gateway` (Dockerfile), 포트 **8091:8091** (dev 노출), env: PORT=8091, INTERNAL_API_KEY, DEV_MOCK=false, RPC_URL=https://sepolia.base.org, CHAIN_ID=84532, PAYMENT_CONTRACT_ADDRESS=0x7fD9208e601c69639F6875EC24717e8476A2cCb1, USDC_TOKEN_ADDRESS=0xe0661BAff428a1d57cb717E5Ce15Deca4F847E90, OPERATOR_PRIVATE_KEY (env_file .env + environment 오버라이드), healthcheck /health
- `shop-api`: build context `../server` (Dockerfile), 포트 **8095:8095** (dev 노출), env: DB_HOST=shop-postgres, DB_PORT=5432, DB_USER/DB_PASSWORD/DB_NAME, APP_ENV=dev, DEV_FAKE_SIGNATURE=0xdev, BLOCKCHAIN_GATEWAY_URL=http://gateway-shop:8091, INTERNAL_API_KEY, SELLING_DB_URL (싱크 소스 — 호스트 selling_dd DB: `postgresql://selling_dd:***@172.17.0.1:5432/selling_dd` — docker bridge 호스트 IP), depends_on shop-postgres healthy
- `shop-web`: build context `../web` (Dockerfile), 포트 **80:80** (또는 8082 — 80이 비어있으면 80), depends_on shop-api
- 볼륨: shop_pgdata

주의:
- `docker compose up -d --build` 는 `| tail` 금지 (빌드 실패 흡수) — `docker compose build` 먼저 단독 실행으로 exit code 확인, 그다음 `up -d`
- 기존 호스트 프로세스(shop-server-bin, vite dev, shop-gateway docker run)와 포트 충돌 시: 기존 것 중지 (shop-gateway는 docker rm -f 후 compose가 새로 띄움 — **게이트웨이 컨테이너는 compose가 관리**)
- 호스트 80 사용 중이면 8082 사용 (nginx.conf 불필요 변경 — 포트 매핑만)

## 3. 배포 + 검증 (전부 실측)
- `docker compose up -d` → 전 서비스 healthy
- `curl localhost:80/` → HTML 200 (직구창고 타이틀)
- `curl localhost:80/api/products` → listed 상품 1건 (Toocki, 2800원)
- `curl localhost:8091/health` → ok
- 지갑 인증 스모크: nonce → 0xdev verify → JWT → `GET /api/orders` 200 (빈 목록)

## 4. cloudflared 터널 (쇼핑몰 공개)
- `cloudflared tunnel --url http://localhost:80 --no-autoupdate` 를 **로그파일 리다이렉트로 백그라운드** (stdout 파이프 금지 — SIGPIPE로 죽음): `cloudflared tunnel --url http://localhost:80 --no-autoupdate > /tmp/shop-tunnel.log 2>&1 &`
- 로그에서 `https://xxx.trycloudflare.com` 추출 → 외부 URL로 `curl /` 200 + `/api/products` 200 확인
- URL을 `~/shop_dd/.omo/evidence/p6-deploy.txt`에 기록 (참고용)

## 5. 커밋
`web/Dockerfile`, `deploy/docker-compose.yml`, `deploy/.env.example`, `web/nginx.conf`, `.omo/evidence/p6-deploy.txt` → `"P6: docker-compose 통합 배포"` + push.
마지막 요약: 서비스 목록/상태, 내부+외부 URL 검증 결과, 터널 URL.
