const { expect } = require("chai");
const { ethers } = require("hardhat");

const USDC_DECIMALS = 6n;
const toUsdc = (n) => n * 10n ** USDC_DECIMALS;

async function deployFixture() {
  const [owner, user, treasury, stranger, attacker] = await ethers.getSigners();

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();

  const ShopPayment = await ethers.getContractFactory("ShopPayment");
  const payment = await ShopPayment.deploy(await usdc.getAddress(), treasury.address);

  // 사용자들에게 USDC 지급
  for (const u of [user, stranger, attacker]) {
    await usdc.faucet(u.address, toUsdc(1000n));
  }

  return { owner, user, treasury, stranger, attacker, usdc, payment };
}

describe("ShopPayment", function () {
  it("배포: owner == deployer, usdc() == MockUSDC, treasury() == treasury", async function () {
    const { owner, usdc, payment, treasury } = await deployFixture();
    expect(await payment.owner()).to.equal(owner.address);
    expect(await payment.usdc()).to.equal(await usdc.getAddress());
    expect(await payment.treasury()).to.equal(treasury.address);
  });

  it("미등록 주문 pay → OrderNotRegistered", async function () {
    const { user, usdc, payment } = await deployFixture();
    const orderId = 999n;
    const amount = toUsdc(2n);
    await usdc.connect(user).approve(await payment.getAddress(), amount);
    await expect(payment.connect(user).pay(orderId, amount)).to.be.revertedWithCustomError(
      payment,
      "OrderNotRegistered"
    );
  });

  it("registerOrder 후 pay: payer가 아니면 NotOrderPayer, 금액 불일치 AmountMismatch", async function () {
    const { owner, user, attacker, usdc, payment } = await deployFixture();
    const orderId = 3n;
    const amount = toUsdc(5n);

    await payment.connect(owner).registerOrder(orderId, user.address, amount);
    await usdc.connect(attacker).approve(await payment.getAddress(), toUsdc(1000n));

    // payer가 아닌 attacker → NotOrderPayer
    await expect(payment.connect(attacker).pay(orderId, amount)).to.be.revertedWithCustomError(
      payment,
      "NotOrderPayer"
    );

    // payer지만 금액 불일치 → AmountMismatch
    await usdc.connect(user).approve(await payment.getAddress(), toUsdc(100n));
    await expect(payment.connect(user).pay(orderId, amount - 1n)).to.be.revertedWithCustomError(
      payment,
      "AmountMismatch"
    );
  });

  it("pay 성공: processedOrderIds==true, PaymentSettled 이벤트(treasury 포함), USDC 이동(6자리)", async function () {
    const { owner, user, treasury, usdc, payment } = await deployFixture();
    const orderId = 42n;
    const amount = toUsdc(5n); // 5 USDC

    await payment.connect(owner).registerOrder(orderId, user.address, amount);
    await usdc.connect(user).approve(await payment.getAddress(), amount);
    await expect(payment.connect(user).pay(orderId, amount))
      .to.emit(payment, "PaymentSettled")
      .withArgs(orderId, user.address, amount, treasury.address);

    expect(await payment.processedOrderIds(orderId)).to.equal(true);
    expect(await usdc.balanceOf(treasury.address)).to.equal(amount);
    expect(await usdc.balanceOf(user.address)).to.equal(toUsdc(995n));
  });

  it("중복 registerOrder(같은 orderId) → OrderAlreadyRegistered", async function () {
    const { owner, user, payment } = await deployFixture();
    const orderId = 2n;
    await payment.connect(owner).registerOrder(orderId, user.address, toUsdc(1n));
    await expect(
      payment.connect(owner).registerOrder(orderId, user.address, toUsdc(1n))
    ).to.be.revertedWithCustomError(payment, "OrderAlreadyRegistered");
  });

  it("cancelOrder: 미등록 OrderNotRegistered / processed OrderAlreadyPaid / 성공 시 재등록 가능", async function () {
    const { owner, user, usdc, payment } = await deployFixture();

    // 미등록 주문 취소 → OrderNotRegistered
    await expect(payment.connect(owner).cancelOrder(80n)).to.be.revertedWithCustomError(
      payment,
      "OrderNotRegistered"
    );

    // 결제 완료 주문 취소 → OrderAlreadyPaid
    const paidId = 78n;
    await payment.connect(owner).registerOrder(paidId, user.address, toUsdc(1n));
    await usdc.connect(user).approve(await payment.getAddress(), toUsdc(1n));
    await payment.connect(user).pay(paidId, toUsdc(1n));
    await expect(payment.connect(owner).cancelOrder(paidId)).to.be.revertedWithCustomError(
      payment,
      "OrderAlreadyPaid"
    );

    // 미결제 주문 취소 → 재등록 가능 (복구 증명)
    const cancelId = 77n;
    await payment.connect(owner).registerOrder(cancelId, user.address, toUsdc(3n));
    await expect(payment.connect(owner).cancelOrder(cancelId))
      .to.emit(payment, "OrderCancelled")
      .withArgs(cancelId);
    await payment.connect(owner).registerOrder(cancelId, user.address, toUsdc(4n));
    expect(await payment.orderAmount(cancelId)).to.equal(toUsdc(4n));
  });

  it("registerOrder는 owner만 (비owner revert)", async function () {
    const { stranger, user, payment } = await deployFixture();
    await expect(
      payment.connect(stranger).registerOrder(1n, user.address, toUsdc(1n))
    ).to.be.reverted;
  });

  it("setTreasury: zero-address ZeroAddress, 비owner revert", async function () {
    const { owner, stranger, payment } = await deployFixture();

    // zero address → ZeroAddress
    await expect(payment.connect(owner).setTreasury(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      payment,
      "ZeroAddress"
    );

    // 비owner → revert
    await expect(payment.connect(stranger).setTreasury(stranger.address)).to.be.reverted;
  });

  it("MockUSDC: decimals()==6, faucet mint 증가 확인", async function () {
    const { user, usdc } = await deployFixture();
    expect(await usdc.decimals()).to.equal(6);

    const before = await usdc.balanceOf(user.address);
    await usdc.faucet(user.address, toUsdc(100n));
    expect(await usdc.balanceOf(user.address)).to.equal(before + toUsdc(100n));
  });
});
