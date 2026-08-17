# P2 태스크 — contracts (opencode Atlas - Plan Executor)

구현 + 테스트 + Base Sepolia 배포까지. 질문하지 말고 끝까지 진행해. 완료 후 커밋/푸시.

## 배경
`/home/dduckbeagy/shop_dd/PLAN.md` (v2) + `/home/dduckbeagy/shop_dd/P0_ANALYSIS.md` 먼저 읽어라.
shop_dd = Base Sepolia 테스트넷에서 USDC 스마트컨트랙트 결제로 상품을 파는 쇼핑몰.
결제는 blockchain-gateway가 경유하므로 **컨트랙트 인터페이스가 gateway의 ANALYIST_PAYMENT_ABI와 100% 호환**되어야 한다 (P0 G5 ⚠️: `PaymentSettled` 이벤트에 `address indexed treasury` 필수).

## 참조 (실측 — 그대로 복제)
- `~/contracts/` — 기존 AnalyistPayment 배포 레포 (hardhat 2.22.10 + @nomicfoundation/hardhat-toolbox ^5, solidity 0.8.24, CommonJS hardhat.config.js, baseSepolia 네트워크: url=https://sepolia.base.org, chainId=84532)
- `~/contracts/contracts/AnalyistPayment.sol` — 복제 원본 (Ownable + ReentrancyGuard)
- `~/contracts/contracts/mocks/MockUSDC.sol` — 복제 원본 (6자리)
- `~/contracts/.env` — PRIVATE_KEY / BASE_SEPOLIA_RPC_URL / TREASURY_ADDRESS (키명만 참조, **값 출력 금지**)
- 배포자 지갑 = 0x519c8b06D8E57969B4886e1028863BcDb0C425c4 (Base Sepolia 잔액 ~0.001 ETH)

## 산출물 — `~/shop_dd/contracts/`

### 1. ShopPayment.sol
`AnalyistPayment.sol`을 `ShopPayment`으로 복제 (SPDX/주석에 shop_dd 명시). **인터페이스 100% 유지**:
- `registerOrder(uint256 orderId, address payer, uint256 amountUsdc) external onlyOwner` (이미 등록 시 revert)
- `cancelOrder(uint256 orderId) external onlyOwner` (processed=OrderAlreadyPaid revert, 미등록=OrderNotRegistered revert)
- `pay(uint256 orderId, uint256 amountUsdc) external nonReentrant` (미등록 revert, payer/금액 바인딩, processedOrderIds 세팅, PaymentSettled emit, USDC transfer)
- `setTreasury(address) external onlyOwner` (zero-address revert)
- 매핑: `processedOrderIds(uint256)`, `orderPayer(uint256)`, `orderAmount(uint256)`
- 이벤트: `PaymentSettled(uint256 indexed orderId, address indexed payer, uint256 amountUsdc, address indexed treasury)` ← **treasury indexed 필수**, `OrderRegistered(uint256 indexed orderId, address indexed payer, uint256 amountUsdc)`, `OrderCancelled(uint256 indexed orderId)`, `TreasuryUpdated`

### 2. MockUSDC.sol
`~/contracts/contracts/mocks/MockUSDC.sol` 복제 (decimals=6, mint 함수 보유).

### 3. hardhat.config.js
CommonJS. solidity 0.8.24 + optimizer(runs 200). networks: hardhat(31337) + baseSepolia(84532, `process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"`, accounts=[process.env.PRIVATE_KEY]).

### 4. test/ (hardhat test — 최소 8개, 모두 실질 검증)
1. 배포: ShopPayment owner=deployer, USDC 주소 설정 확인
2. 미등록 주문 pay → revert(OrderNotRegistered)
3. registerOrder 후 pay: payer가 아니면 revert(NotOrderPayer), 금액 불일치 revert(AmountMismatch)
4. pay 성공: processedOrderIds=true, PaymentSettled 이벤트(treasury 포함) emit, USDC 잔액 이동(6자리)
5. 중복 registerOrder(같은 orderId) → revert
6. cancelOrder: 미등록 revert / processed revert / 성공 시 재등록 가능(복구 증명)
7. registerOrder는 owner만 (비owner revert)
8. setTreasury: zero-address revert, 비owner revert
9. MockUSDC: decimals=6, mint 증가 확인

### 5. scripts/deploy.js
- MockUSDC 배포 → ShopPayment(MockUSDC 주소, treasury=process.env.TREASURY_ADDRESS || deployer) 배포
- USDC 주소 오버라이드: `SHOP_USDC_ADDRESS` env 설정 시 그 주소 사용 (실 USDC 0x036CbD53842c5426634e7929541eC2318f3dCF7e 바인딩 옵션)
- `~/shop_dd/contracts/deployed-base-sepolia.json` 기록: {chainId:84532, ShopPayment, USDC, Treasury, deployedAt}
- **가스 사전 확인**: deployer 잔액 eth_getBalance → 예상 가스(estimateGas)보다 부족하면 멈추고 결과만 출력 (faucet 안내: getblock/learnweb3 Base Sepolia 주소입력 faucet)

### 6. 온체인 검증 (배포 후 실행, 결과 출력)
- curl RPC eth_chainId = 84532
- eth_call MockUSDC: symbol/decimals (0x95d89b41/0x313ce567)
- eth_call ShopPayment: owner() (0x8da5cb5b) == deployer
- 각 컨트랙트 eth_getCode != 0x

## 실행 규칙
- .env 값 출력 금지 (키명만). `set -a; source ~/contracts/.env; set +a` 후 hardhat 실행.
- `~/shop_dd/contracts/.env` 신규 생성 금지 (중복 시크릿 금지) — 배포 시 기존 ~/contracts/.env 참조.
- npm install은 `~/shop_dd/contracts/` 에서 (node v22 호스트 OK).
- viem/TS 버전 논쟁 불필요 (이 레포는 ethers — hardhat-toolbox 표준).
- 완료: 테스트 그린 + 배포 + 온체인 검증 출력 → `git add contracts && commit "P2: ShopPayment+MockUSDC 배포" && push` (Jenkins 자동 빌드됨).
- 산출물 증거: 실행한 명령과 출력을 `/home/dduckbeagy/shop_dd/.omo/evidence/p2-contracts.txt` 에 저장 (mkdir -p .omo/evidence).
