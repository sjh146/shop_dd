// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ShopPayment
 * @notice shop_dd 결제 컨트랙트 (Base Sepolia USDC)
 * @dev 사용자는 USDC를 approve한 뒤 pay()를 호출한다.
 *      서버는 개인키를 절대 보유하지 않는다 (사용자 지갑이 직접 서명).
 *      orderId 단위 멱등성: 한 주문은 정확히 한 번만 결제 가능.
 *
 *      보안 설계 (CWE-639 griefing 대응):
 *      운영자가 registerOrder(orderId, payer, amount)로 주문을 사전 등록하면,
 *      pay()는 반드시 등록된 payer + 정확한 금액으로만 결제할 수 있다.
 *      미등록 orderId는 결제 불가 (CWE-799 prepay griefing 차단).
 *
 *      인터페이스는 blockchain-gateway의 ANALYIST_PAYMENT_ABI와 100% 호환된다.
 *      PaymentSettled 이벤트에 address indexed treasury 필수 (gateway txHash 추출).
 */
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ShopPayment is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice 결제 토큰 (native USDC 또는 MockUSDC, 6자리 소수)
    IERC20 public immutable usdc;

    /// @notice 자금 수취 주소 (운영자가 설정)
    address public treasury;

    /// @notice 결제 완료된 주문 (멱등성)
    mapping(uint256 => bool) public processedOrderIds;

    /// @notice 주문별 결제자 (registerOrder로 등록 — CWE-639 방지)
    mapping(uint256 => address) public orderPayer;

    /// @notice 주문별 결제 금액 (USDC 마이크로 단위)
    mapping(uint256 => uint256) public orderAmount;

    event PaymentSettled(
        uint256 indexed orderId,
        address indexed payer,
        uint256 amountUsdc,
        address indexed treasury
    );
    event OrderRegistered(uint256 indexed orderId, address indexed payer, uint256 amountUsdc);
    event OrderCancelled(uint256 indexed orderId);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    error ZeroAddress();
    error ZeroAmount();
    error OrderAlreadyPaid(uint256 orderId);
    error OrderAlreadyRegistered(uint256 orderId);
    error OrderNotRegistered(uint256 orderId);
    error NotOrderPayer(uint256 orderId);
    error AmountMismatch(uint256 expected, uint256 actual);

    constructor(address usdcToken_, address treasury_) Ownable(msg.sender) {
        if (usdcToken_ == address(0)) revert ZeroAddress();
        if (treasury_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdcToken_);
        treasury = treasury_;
    }

    /// @notice 수취 주소 변경 (운영자 전용)
    function setTreasury(address newTreasury_) external onlyOwner {
        if (newTreasury_ == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury_);
        treasury = newTreasury_;
    }

    /**
     * @notice 주문 사전 등록 (운영자 전용 — 서버가 주문 생성 시 호출)
     * @param orderId 주문 ID (payments.reference_id의 uint256 해시)
     * @param payer 결제 예정 지갑 주소
     * @param amountUsdc 결제 예정 금액 (6자리, 5 USDC = 5000000)
     * @dev 등록 후에는 해당 주소와 정확한 금액으로만 pay() 가능.
     *      미등록 주문에 대한 front-running griefing(CWE-639)을 차단한다.
     */
    function registerOrder(uint256 orderId, address payer, uint256 amountUsdc) external onlyOwner {
        if (payer == address(0)) revert ZeroAddress();
        if (amountUsdc == 0) revert ZeroAmount();
        if (orderPayer[orderId] != address(0)) revert OrderAlreadyRegistered(orderId);

        orderPayer[orderId] = payer;
        orderAmount[orderId] = amountUsdc;
        emit OrderRegistered(orderId, payer, amountUsdc);
    }

    /**
     * @notice 잘못 등록된 주문 취소 (owner 전용 — CWE-639: 등록 오류 복구 불가 문제 해결)
     * @dev 미결제 주문만 취소 가능. 결제 완료(orderId processed)된 주문은 불가.
     */
    function cancelOrder(uint256 orderId) external onlyOwner {
        if (processedOrderIds[orderId]) revert OrderAlreadyPaid(orderId);
        if (orderPayer[orderId] == address(0)) revert OrderNotRegistered(orderId);

        delete orderPayer[orderId];
        delete orderAmount[orderId];
        emit OrderCancelled(orderId);
    }

    /**
     * @notice 주문 결제
     * @param orderId 주문 ID
     * @param amountUsdc USDC 수량 (6자리 소수)
     * @dev 선행: 1) 운영자가 registerOrder로 주문 사전등록 (필수 — CWE-799)
     *           2) 사용자가 이 컨트랙트에 amountUsdc 만큼 approve
     *      등록 안 된 orderId는 결제 불가 (OrderNotRegistered).
     */
    function pay(uint256 orderId, uint256 amountUsdc) external nonReentrant {
        address expectedPayer = orderPayer[orderId];
        // 미등록 주문은 결제 불가 — 미등록 prepay griefing(CWE-799) 차단
        if (expectedPayer == address(0)) revert OrderNotRegistered(orderId);
        // 결제자·금액 바인딩 (CWE-639 / 과소결제 차단)
        if (msg.sender != expectedPayer) revert NotOrderPayer(orderId);
        if (amountUsdc != orderAmount[orderId]) {
            revert AmountMismatch(orderAmount[orderId], amountUsdc);
        }
        if (processedOrderIds[orderId]) revert OrderAlreadyPaid(orderId);

        processedOrderIds[orderId] = true;
        usdc.safeTransferFrom(msg.sender, treasury, amountUsdc);

        emit PaymentSettled(orderId, msg.sender, amountUsdc, treasury);
    }
}
