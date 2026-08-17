# P3 태스크 — gateway shop 인스턴스 + 온체인 E2E (opencode Atlas)

질문하지 말고 끝까지 진행해. 완료 후 커밋/푸시.

## 배경
`/home/dduckbeagy/shop_dd/PLAN.md` §P3 + `/home/dduckbeagy/shop_dd/P0_ANALYSIS.md` §3(gateway API 계약) 읽어라.
P2 완료: ShopPayment `0x7fD9208e601c69639F6875EC24717e8476A2cCb1` + MockUSDC `0xe0661BAff428a1d57cb717E5Ce15Deca4F847E90` (Base Sepolia, chainId 84532, `~/shop_dd/contracts/deployed-base-sepolia.json`).
이제 **blockchain-gateway를 코드 수정 없이 env 인스턴스로 띄워** shop_dd 결제를 서빙하고, **테스트 payer로 온체인 register→approve→pay→verify E2E**를 완성한다.

## 시크릿 규칙 (절대 위반 금지)
- `~/contracts/.env`의 PRIVATE_KEY 값을 **절대 출력/로깅/커밋 금지**. 사용은 `set -a; source ~/contracts/.env; set +a` 후 `$PRIVATE_KEY`로만.
- 생성하는 INTERNAL_API_KEY 값도 출력 금지 — `~/.hermes/secrets/shop_gateway_key.txt`에 저장 후 참조.
- E2E 테스트 payer 개인키는 `/tmp/shop_e2e_payer.key`에 저장, 커밋 금지.

## 1. gateway shop 인스턴스 기동
- 이미지 빌드: `cd ~/blockchain-gateway && docker build -t blockchain-gateway:shop .` (Dockerfile 확인)
- 실행 (이름 shop-gateway, 호스트 8091):
```
docker rm -f shop-gateway 2>/dev/null; docker run -d --name shop-gateway --restart unless-stopped \
  -p 8091:8091 -e PORT=8091 \
  -e INTERNAL_API_KEY="$(cat ~/.hermes/secrets/shop_gateway_key.txt)" \
  -e DEV_MOCK=false -e RPC_URL=https://sepolia.base.org -e CHAIN_ID=84532 \
  -e PAYMENT_CONTRACT_ADDRESS=0x7fD9208e601c69639F6875EC24717e8476A2cCb1 \
  -e USDC_TOKEN_ADDRESS=0xe0661BAff428a1d57cb717E5Ce15Deca4F847E90 \
  -e OPERATOR_PRIVATE_KEY="$PRIVATE_KEY" blockchain-gateway:shop
```
  (bash에서 source 후 실행 — PRIVATE_KEY 전개는 셸 안에서만)
- 헬스: `curl -s localhost:8091/health` → `{"status":"ok"}` 확인
- 기동 실패 시: `docker logs shop-gateway` 확인 (INTERNAL_API_KEY fail-closed 등) — 고치고 재시도

## 2. gateway API 스모크 (register/verify 응답 형태)
- `reference_id="e2e-order-1"`, payer=아래 테스트 payer 주소, amount_usdc="2500000" (2.5 mUSDC micro)
- register 응답에서 `order_id` 확인 (P0 §3: BigInt(keccak256(toHex(reference_id))) — viem으로 계산해 일치 검증: `node -e` + keccak256)
- 검증 전 verify → `verified:false` 기대 (not paid)

## 3. 온체인 E2E 스크립트 — `~/shop_dd/tests/e2e-gateway.cjs` (커밋 대상)
viem 2.21.55 사용 (`NODE_PATH=/home/dduckbeagy/blockchain-gateway/node_modules node tests/e2e-gateway.cjs`):
1. 테스트 payer 지갑 생성 (랜덤 키, `/tmp/shop_e2e_payer.key` 저장) — 0xdev 아님, 진짜 키
2. 펀딩 (deployer=PRIVATE_KEY가 서명):
   - MockUSDC.mint(payer, 10_000_000n) (10 mUSDC) — deployer가 가스 지불
   - deployer → payer로 0.0003 ETH 전송 (payer의 approve+pay 가스용)
3. gateway register: `{reference_id:"e2e-order-1", wallet_address:payer, amount_usdc:"2500000"}` (X-Internal-Api-Key 헤더) → order_id 획득
4. payer: MockUSDC.approve(ShopPayment, 2_500_000n)
5. payer: ShopPayment.pay(orderId, 2_500_000n)  ← **사용자 서명 패턴** (운영자 대납 금지, execute 호출 금지)
6. gateway verify: `{reference_id:"e2e-order-1"}` → `verified:true`, `payer==payer`, `amount_usdc=="2500000"`, `tx_hash` 존재
7. payer의 MockUSDC 잔액/ShopPayment 잔액 확인 (10e6 → 7.5e6, ShopPayment 2.5e6)
8. 모든 단계 결과 출력 (시크릿 제외)
- pay() revert 시 진단: allowance 재조회 → 재-approve (더 큰 금액), `NotOrderPayer`/`OrderNotRegistered` 아니면 orderPayer/orderAmount 상태 직접 조회 (evm_payments 스킬 패턴)
- pay 직후 processedOrderIds false면 몇 초 후 재조회 (RPC 인덱싱 지연)

## 4. 산출물/증거/커밋
- 실행 출력 저장: `~/shop_dd/.omo/evidence/p3-gateway-e2e.txt`
- `~/shop_dd/scripts/start-shop-gateway.sh` (위 docker run을 멱등화한 스크립트 — 시크릿 없이 env 파일/변수 참조만, 600 권한)
- `~/shop_dd/.env.example` 갱신: `SHOP_GATEWAY_URL=http://localhost:8091`, `SHOP_GATEWAY_INTERNAL_API_KEY=<생성값은 .env에, 예제엔 placeholder>` — **예제 파일에 실제 키 금지**
- 커밋: `git add tests/e2e-gateway.cjs scripts/start-shop-gateway.sh .env.example .omo/evidence/p3-gateway-e2e.txt && commit "P3: gateway shop 인스턴스 + 온체인 E2E" && push` (Jenkins 자동 빌드)
- 마지막 출력: E2E 전체 결과 요약 (tx_hash, 검증 결과, 잔액 변화)
