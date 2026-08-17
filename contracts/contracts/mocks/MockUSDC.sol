// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice shop_dd 테스트용 USDC 모의 토큰 — mainnet USDC와 동일하게 6자리 소수
 * @dev 테스트/로컬 개발 전용. 프로덕션은 native USDC(Base) 사용.
 */
contract MockUSDC is ERC20 {
    uint8 private constant _DECIMALS = 6;

    constructor() ERC20("Mock USDC", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }

    /// @notice 테스트용 민트 (누구나 — 테스트넷 전용)
    function faucet(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
