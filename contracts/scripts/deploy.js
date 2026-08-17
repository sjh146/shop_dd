// Base Sepolia 배포 스크립트 (CommonJS)
// 사용법: npx hardhat run scripts/deploy.js --network baseSepolia
// 사전 준비: .env에 PRIVATE_KEY, BASE_SEPOLIA_RPC_URL 설정
const fs = require("fs");
const path = require("path");

// Base Sepolia native USDC 주소 (Circle 공식) — 배포 전 재검증 필수
// 참고: https://www.circle.com/usdc-multichain (Base Sepolia)
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

// 가스 사전 확인 안전 마진 (예상 가스비 대비 1.5배)
const GAS_SAFETY_MARGIN = 1.5;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // 1) MockUSDC 먼저 배포 (로컬/테스트용)
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUsdc = await MockUSDC.deploy();
  await mockUsdc.waitForDeployment();
  const mockUsdcAddr = await mockUsdc.getAddress();
  console.log("MockUSDC deployed at:", mockUsdcAddr);

  // 2) USDC 주소 결정: SHOP_USDC_ADDRESS가 설정되면 실제 USDC 바인딩, 아니면 방금 배포한 mock
  const USDC_ADDRESS = process.env.SHOP_USDC_ADDRESS || mockUsdcAddr;
  if (process.env.SHOP_USDC_ADDRESS) {
    console.log("Using real USDC (SHOP_USDC_ADDRESS):", USDC_ADDRESS);
  } else {
    console.log("Using freshly-deployed MockUSDC as USDC:", USDC_ADDRESS);
  }

  // 3) Treasury 결정
  const TREASURY = process.env.TREASURY_ADDRESS || deployer.address;
  console.log("Treasury:", TREASURY);

  // 4) ShopPayment 배포 전 가스 사전 확인
  const ShopPayment = await ethers.getContractFactory("ShopPayment");

  // 배포 트랜잭션을 미리 만들어 가스 추정
  const deployTx = await ShopPayment.getDeployTransaction(USDC_ADDRESS, TREASURY);
  const estimatedGas = await ethers.provider.estimateGas(deployTx);
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? (await ethers.provider.getGasPrice());

  const estimatedCost = estimatedGas * gasPrice;
  const requiredBalance = (estimatedCost * BigInt(Math.round(GAS_SAFETY_MARGIN * 100))) / 100n;

  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("--- Gas pre-check ---");
  console.log("Deployer balance:", ethers.formatEther(balance), "ETH");
  console.log("Estimated gas:", estimatedGas.toString());
  console.log("Gas price:", ethers.formatUnits(gasPrice, "gwei"), "gwei");
  console.log("Estimated deploy cost:", ethers.formatEther(estimatedCost), "ETH");
  console.log("Required balance (1.5x margin):", ethers.formatEther(requiredBalance), "ETH");

  if (balance < requiredBalance) {
    console.error(
      "\n[ABORT] Deployer balance is insufficient for ShopPayment deployment."
    );
    console.error(
      `  Balance: ${ethers.formatEther(balance)} ETH < required ${ethers.formatEther(requiredBalance)} ETH`
    );
    console.error(
      "\nFaucet guidance (Base Sepolia):\n" +
        "  - getblock.io faucet: https://getblock.io/faucet/base-sepolia/\n" +
        "  - learnweb3 faucet: https://learnweb3.io/faucets/base_sepolia/\n" +
        "  Fund the deployer address above, then re-run this script."
    );
    process.exitCode = 1;
    return;
  }
  console.log("Balance sufficient. Proceeding with deployment.\n");

  // 5) ShopPayment 배포
  const payment = await ShopPayment.deploy(USDC_ADDRESS, TREASURY);
  await payment.waitForDeployment();
  const addr = await payment.getAddress();
  console.log("ShopPayment deployed at:", addr);

  // 6) 배포 결과 기록
  const outPath = path.join(__dirname, "..", "deployed-base-sepolia.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        chainId: 84532,
        ShopPayment: addr,
        USDC: USDC_ADDRESS,
        Treasury: TREASURY,
        deployedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
  console.log("deployed-base-sepolia.json written");

  // 7) 주소 출력
  console.log("\n--- Deployed addresses ---");
  console.log("ShopPayment:", addr);
  console.log("USDC:", USDC_ADDRESS);
  console.log("Treasury:", TREASURY);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
