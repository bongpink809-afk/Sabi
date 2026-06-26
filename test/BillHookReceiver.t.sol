// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {BillHookReceiver, WrongSender, WrongAmount, UnauthorizedCaller, HookValidated} from "../src/BillHookReceiver.sol";
import {IHookReceiver} from "../src/interfaces/IHookReceiver.sol";

contract BillHookReceiverTest is Test {
    // ─── Hằng số test ─────────────────────────────────────────────────────────

    address constant USDC          = 0x3600000000000000000000000000000000000000;
    address constant TRANSMITTER   = address(0x1111);
    address constant EXPECTED_USER = address(0xABCD);
    uint256 constant EXPECTED_AMT  = 1_000_000; // 1 USDC (6 decimals)

    // BurnMessageV2 offsets — phải khớp với hằng số trong BillHookReceiver.sol
    uint256 constant OFFSET_AMOUNT  = 68;
    uint256 constant OFFSET_SENDER  = 100;
    uint256 constant BODY_LEN       = 300; // đủ lớn để chứa tất cả các field

    BillHookReceiver hook;

    function setUp() public {
        hook = new BillHookReceiver(EXPECTED_USER, EXPECTED_AMT, TRANSMITTER, USDC);
    }

    // ─── Helper: tạo messageBody tổng hợp ────────────────────────────────────

    /// @dev Cấp phát buffer 300 byte, ghi sender tại offset 100 và amount tại offset 68.
    ///      Các field còn lại (version, burnToken, v.v.) để 0 — không ảnh hưởng đến test.
    function _buildBody(bytes32 sender, uint256 amount) internal pure returns (bytes memory body) {
        body = new bytes(BODY_LEN);
        assembly {
            // body là con trỏ đến length prefix; data bắt đầu tại body+32
            let ptr := add(body, 32)
            mstore(add(ptr, OFFSET_AMOUNT), amount)
            mstore(add(ptr, OFFSET_SENDER), sender)
        }
    }

    function _expectedSenderBytes32() internal pure returns (bytes32) {
        return bytes32(uint256(uint160(EXPECTED_USER)));
    }

    // ─── Test 1: Happy path ───────────────────────────────────────────────────

    function test_ValidMessage_EmitsHookValidated() public {
        bytes memory body = _buildBody(_expectedSenderBytes32(), EXPECTED_AMT);

        // hookData = bytes 228–299 của body — toàn bộ là 0 vì _buildBody chỉ ghi tại offset 68 và 100
        bytes memory expectedHookData = new bytes(BODY_LEN - 228);
        vm.expectEmit(true, false, false, true, address(hook));
        emit HookValidated(_expectedSenderBytes32(), EXPECTED_AMT, expectedHookData);

        vm.prank(TRANSMITTER);
        bool ret = hook.handleReceiveFinalizedMessage(6, bytes32(0), 500, body);

        assertTrue(ret);
    }

    // ─── Test 2: Sai sender ───────────────────────────────────────────────────

    function test_WrongSender_Reverts() public {
        bytes32 wrongSender = bytes32(uint256(uint160(address(0xDEAD))));
        bytes memory body = _buildBody(wrongSender, EXPECTED_AMT);

        vm.expectRevert(abi.encodeWithSelector(WrongSender.selector, wrongSender, _expectedSenderBytes32()));
        vm.prank(TRANSMITTER);
        hook.handleReceiveFinalizedMessage(6, bytes32(0), 500, body);
    }

    // ─── Test 3: Sai amount ───────────────────────────────────────────────────

    function test_WrongAmount_Reverts() public {
        uint256 wrongAmount = 999_999;
        bytes memory body = _buildBody(_expectedSenderBytes32(), wrongAmount);

        vm.expectRevert(abi.encodeWithSelector(WrongAmount.selector, wrongAmount, EXPECTED_AMT));
        vm.prank(TRANSMITTER);
        hook.handleReceiveFinalizedMessage(6, bytes32(0), 500, body);
    }

    // ─── Test 4: Cả hai sai — ưu tiên WrongSender ────────────────────────────
    // Priority: WrongSender được kiểm tra trước WrongAmount.
    // Nếu thay đổi thứ tự kiểm tra trong contract, test này sẽ fail — cố ý.

    function test_BothWrong_RevertsWithWrongSender() public {
        bytes32 wrongSender = bytes32(uint256(uint160(address(0xBEEF))));
        bytes memory body = _buildBody(wrongSender, 1); // sai cả sender lẫn amount

        vm.expectRevert(abi.encodeWithSelector(WrongSender.selector, wrongSender, _expectedSenderBytes32()));
        vm.prank(TRANSMITTER);
        hook.handleReceiveFinalizedMessage(6, bytes32(0), 500, body);
    }

    // ─── Test 5: Unauthorized caller ─────────────────────────────────────────

    function test_UnauthorizedCaller_Reverts() public {
        bytes memory body = _buildBody(_expectedSenderBytes32(), EXPECTED_AMT);
        address rogue = address(0xDEAD);

        vm.expectRevert(abi.encodeWithSelector(UnauthorizedCaller.selector, rogue));
        vm.prank(rogue);
        hook.handleReceiveFinalizedMessage(6, bytes32(0), 500, body);
    }
}
