// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {BillHookReceiver, WrongSender, WrongAmount, UnauthorizedCaller, HookValidated} from "../src/BillHookReceiver.sol";

/// @notice Integration test dùng raw messageBody thật từ burn tx on-chain.
///
/// Burn tx (Base Sepolia):  0xe987e3d62e2556a6b48fd5abc72061670430f82cceeb5bbabda5370cc0e5300d
/// Relay tx (Arc Testnet): 0xd01aed96c5993a727ff53153fb1a1e0c55ea5f42654a432d240b4dbe75d63ef5
///
/// Phát hiện: MessageV2 header = 148 bytes (không phải 140).
/// 8 byte thừa tại offset 140–147 là 2 field uint32 của V2 (mỗi field = 2000 = 0x7D0).
/// messageBody truyền vào handleReceiveFinalizedMessage bắt đầu tại byte 148 của full message.
/// Tất cả offset trong BillHookReceiver (68, 100, 228) đã được verify đúng qua decode Python.
contract BillHookReceiverRealDataTest is Test {

    // ─── Giá trị thật đã verify từ burn tx ────────────────────────────────────

    address constant EXPECTED_SENDER     = 0x282aC4DDcb3dC160B5C802937bA12f9b0f3d6f92;
    uint256 constant EXPECTED_AMOUNT     = 1_000_000; // 1 USDC (6 decimals)
    address constant MESSAGE_TRANSMITTER = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;
    address constant ARC_USDC            = 0x3600000000000000000000000000000000000000;

    // ─── messageBody thật (229 bytes = byte 148 trở đi của Iris API response) ─
    //
    // Verified:
    //   offset 0   version         = 0x1
    //   offset 4   burnToken       = 0x036CbD53842c5426634e7929541eC2318f3dCF7e (Base Sepolia USDC)
    //   offset 36  mintRecipient   = 0x624887de368020F3365a5E257620C0810fE03001 (BillHookReceiver)
    //   offset 68  amount          = 1000000 ✓
    //   offset 100 messageSender   = 0x282aC4DDcb3dC160B5C802937bA12f9b0f3D6F92 ✓
    //   offset 132 maxFee          = 0
    //   offset 164 feeExecuted     = 0
    //   offset 196 expirationBlock = 0
    //   offset 228 hookData        = 0x00 (1 byte)
    bytes constant REAL_BODY = hex"00000001000000000000000000000000036cbd53842c5426634e7929541ec2318f3dcf7e000000000000000000000000624887de368020f3365a5e257620c0810fe0300100000000000000000000000000000000000000000000000000000000000f4240000000000000000000000000282ac4ddcb3dc160b5c802937ba12f9b0f3d6f920000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

    BillHookReceiver hook;

    function setUp() public {
        hook = new BillHookReceiver(
            EXPECTED_SENDER,
            EXPECTED_AMOUNT,
            MESSAGE_TRANSMITTER,
            ARC_USDC
        );
    }

    // ─── Test 1: Happy path — xác nhận offset decode đúng với dữ liệu on-chain thật

    function test_RealData_HappyPath() public {
        bytes32 expectedSenderBytes32 = bytes32(uint256(uint160(EXPECTED_SENDER)));
        bytes memory expectedHookData = hex"0000"; // 2 bytes hookData thật (verify từ trace)

        vm.expectEmit(true, false, false, true, address(hook));
        emit HookValidated(expectedSenderBytes32, EXPECTED_AMOUNT, expectedHookData);

        vm.prank(MESSAGE_TRANSMITTER);
        bool ok = hook.handleReceiveFinalizedMessage(6, bytes32(0), 2000, REAL_BODY);
        assertTrue(ok);
    }

    // ─── Test 2: UnauthorizedCaller

    function test_RealData_UnauthorizedCaller_Reverts() public {
        address rogue = address(0xDEAD);
        vm.prank(rogue);
        vm.expectRevert(abi.encodeWithSelector(UnauthorizedCaller.selector, rogue));
        hook.handleReceiveFinalizedMessage(6, bytes32(0), 2000, REAL_BODY);
    }

    // ─── Test 3: WrongSender — thay địa chỉ tại bytes 112–131 (phần address của messageSender field)

    function test_RealData_WrongSender_Reverts() public {
        bytes memory tampered = abi.encodePacked(REAL_BODY);
        address wrongAddr = address(0xDEADBEEF);
        bytes20 wrongAddrBytes = bytes20(wrongAddr);
        // messageSender tại offset 100 (32 bytes): bytes 100–111 là padding, bytes 112–131 là địa chỉ
        for (uint256 i = 0; i < 20; i++) {
            tampered[112 + i] = wrongAddrBytes[i];
        }
        bytes32 wrongSender32 = bytes32(uint256(uint160(wrongAddr)));

        vm.prank(MESSAGE_TRANSMITTER);
        vm.expectRevert(
            abi.encodeWithSelector(
                WrongSender.selector,
                wrongSender32,
                bytes32(uint256(uint160(EXPECTED_SENDER)))
            )
        );
        hook.handleReceiveFinalizedMessage(6, bytes32(0), 2000, tampered);
    }

    // ─── Test 4: WrongAmount — sửa 3 byte cuối của amount field về 1

    function test_RealData_WrongAmount_Reverts() public {
        bytes memory tampered = abi.encodePacked(REAL_BODY);
        // amount tại offset 68–99: 3 byte cuối là 0x0f, 0x42, 0x40 (= 1,000,000)
        // Sửa về 0x00, 0x00, 0x01 → amount = 1
        tampered[97] = 0x00;
        tampered[98] = 0x00;
        tampered[99] = 0x01;

        vm.prank(MESSAGE_TRANSMITTER);
        vm.expectRevert(
            abi.encodeWithSelector(WrongAmount.selector, uint256(1), EXPECTED_AMOUNT)
        );
        hook.handleReceiveFinalizedMessage(6, bytes32(0), 2000, tampered);
    }
}