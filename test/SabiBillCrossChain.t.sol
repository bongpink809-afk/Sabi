// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SabiBill, BillMode, Bill, Share, InvalidHookData, ReceiveMessageFailed, AlreadyPaid, WrongAmount, SharePaid, SlotFilled} from "../src/Bill.sol";

/// @notice Mock USDC — mint trực tiếp vào SabiBill (giả lập receiveMessage đã mint)
contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient balance");
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        balanceOf[from] -= amount;
        allowance[from][msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @notice Mock MessageTransmitterV2 — giả lập mint USDC vào SabiBill khi receiveMessage được gọi
contract MockMessageTransmitter {
    MockUSDC public usdc;
    bool public shouldFail;

    constructor(address usdc_) {
        usdc = MockUSDC(usdc_);
    }

    function setShouldFail(bool fail) external {
        shouldFail = fail;
    }

    function receiveMessage(
        bytes calldata, /* message */
        bytes calldata  /* attestation */
    ) external returns (bool) {
        if (shouldFail) return false;
        // Giả lập: mint USDC vào msg.sender (= SabiBill contract)
        // amount = 1 USDC mặc định — test sẽ build message với amount tương ứng
        return true;
    }
}

contract SabiBillCrossChainTest is Test {
    SabiBill          sabiBill;
    MockUSDC          usdc;
    MockMessageTransmitter transmitter;

    address organizer = address(0x1111);
    address alice     = address(0x2222);

    uint256 constant ONE_USDC = 1_000_000;

    // ─── Helper: build BurnMessageV2 body thật theo offset đã verify ──────────
    //
    // MessageV2 header = 148 bytes (verified on-chain Phase 1)
    // BurnMessageV2 offsets (từ đầu body):
    //   offset 68:  amount (uint256)
    //   offset 100: messageSender (bytes32)
    //   offset 228: hookData (bytes)

    function _buildMessage(
        uint256 amount,
        address sender,
        bytes memory hookData
    ) internal pure returns (bytes memory) {
        // Header 148 bytes (zeros — không cần verify trong test này)
        bytes memory header = new bytes(148);

        // Body: tổng 228 bytes fixed + hookData
        bytes memory body = new bytes(228 + hookData.length);

        // Ghi amount tại offset 68 (32 bytes)
        bytes32 amountBytes = bytes32(amount);
        for (uint i = 0; i < 32; i++) {
            body[68 + i] = amountBytes[i];
        }

        // Ghi messageSender tại offset 100 (32 bytes, left-pad address)
        bytes32 senderBytes = bytes32(uint256(uint160(sender)));
        for (uint i = 0; i < 32; i++) {
            body[100 + i] = senderBytes[i];
        }

        // Ghi hookData tại offset 228
        for (uint i = 0; i < hookData.length; i++) {
            body[228 + i] = hookData[i];
        }

        return abi.encodePacked(header, body);
    }

    function setUp() public {
        usdc        = new MockUSDC();
        transmitter = new MockMessageTransmitter(address(usdc));
        sabiBill    = new SabiBill(address(usdc), address(transmitter));
    }

    // ─── ASSIGNED mode ────────────────────────────────────────────────────────

    function test_CrossChain_Assigned_HappyPath() public {
        // Tạo bill ASSIGNED
        address[] memory wallets = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        wallets[0] = alice;
        amounts[0] = ONE_USDC;
        vm.prank(organizer);
        uint256 billId = sabiBill.createAssignedBill(wallets, amounts);

        // Mint USDC vào SabiBill (giả lập receiveMessage đã mint)
        usdc.mint(address(sabiBill), ONE_USDC);

        bytes memory hookData = abi.encode(billId, uint256(0)); // shareId = 0
        bytes memory message  = _buildMessage(ONE_USDC, alice, hookData);

        uint256 orgBefore = usdc.balanceOf(organizer);

        vm.expectEmit(true, true, false, true, address(sabiBill));
        emit SharePaid(billId, 0, alice, ONE_USDC);
        sabiBill.payCrossChain(message, bytes(""));

        assertEq(usdc.balanceOf(organizer), orgBefore + ONE_USDC);
        assertTrue(sabiBill.getShare(billId, 0).paid);
    }

    function test_CrossChain_Assigned_AlreadyPaid_Reverts() public {
        address[] memory wallets = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        wallets[0] = alice;
        amounts[0] = ONE_USDC;
        vm.prank(organizer);
        uint256 billId = sabiBill.createAssignedBill(wallets, amounts);

        // Lần 1 — thành công
        usdc.mint(address(sabiBill), ONE_USDC);
        bytes memory hookData = abi.encode(billId, uint256(0));
        bytes memory message  = _buildMessage(ONE_USDC, alice, hookData);
        sabiBill.payCrossChain(message, bytes(""));

        // Lần 2 — revert AlreadyPaid
        usdc.mint(address(sabiBill), ONE_USDC);
        vm.expectRevert(abi.encodeWithSelector(AlreadyPaid.selector, billId, 0));
        sabiBill.payCrossChain(message, bytes(""));
    }

    function test_CrossChain_Assigned_WrongAmount_Reverts() public {
        address[] memory wallets = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        wallets[0] = alice;
        amounts[0] = ONE_USDC;
        vm.prank(organizer);
        uint256 billId = sabiBill.createAssignedBill(wallets, amounts);

        usdc.mint(address(sabiBill), 500_000);
        bytes memory hookData = abi.encode(billId, uint256(0));
        bytes memory message  = _buildMessage(500_000, alice, hookData); // sai amount

        vm.expectRevert(abi.encodeWithSelector(WrongAmount.selector, billId, 0, 500_000, ONE_USDC));
        sabiBill.payCrossChain(message, bytes(""));
    }

    // ─── OPEN_SLOT mode ───────────────────────────────────────────────────────

    function test_CrossChain_OpenSlot_Matched() public {
        vm.prank(organizer);
        uint256 billId = sabiBill.createOpenSlotBill(ONE_USDC, 3);

        usdc.mint(address(sabiBill), ONE_USDC);
        bytes memory hookData = abi.encode(billId); // chỉ billId
        bytes memory message  = _buildMessage(ONE_USDC, alice, hookData);

        uint256 orgBefore = usdc.balanceOf(organizer);

        vm.expectEmit(true, false, false, true, address(sabiBill));
        emit SlotFilled(billId, alice, ONE_USDC, true);
        sabiBill.payCrossChain(message, bytes(""));

        assertEq(usdc.balanceOf(organizer), orgBefore + ONE_USDC);
        assertEq(sabiBill.getBill(billId).matchedSlotsCount, 1);
    }

    function test_CrossChain_OpenSlot_Extra() public {
        vm.prank(organizer);
        uint256 billId = sabiBill.createOpenSlotBill(ONE_USDC, 3);

        uint256 wrongAmount = 500_000;
        usdc.mint(address(sabiBill), wrongAmount);
        bytes memory hookData = abi.encode(billId);
        bytes memory message  = _buildMessage(wrongAmount, alice, hookData);

        sabiBill.payCrossChain(message, bytes(""));

        assertEq(sabiBill.getBill(billId).matchedSlotsCount, 0);
        assertEq(sabiBill.getBill(billId).extraReceived, wrongAmount);
    }

    // ─── Edge cases ───────────────────────────────────────────────────────────

    function test_CrossChain_InvalidHookData_Reverts() public {
        vm.prank(organizer);
        sabiBill.createOpenSlotBill(ONE_USDC, 1);

        usdc.mint(address(sabiBill), ONE_USDC);
        bytes memory hookData = bytes(""); // rỗng — không đủ 32 bytes
        bytes memory message  = _buildMessage(ONE_USDC, alice, hookData);

        vm.expectRevert(InvalidHookData.selector);
        sabiBill.payCrossChain(message, bytes(""));
    }

    function test_CrossChain_ReceiveMessageFailed_Reverts() public {
        vm.prank(organizer);
        sabiBill.createOpenSlotBill(ONE_USDC, 1);

        transmitter.setShouldFail(true);

        bytes memory hookData = abi.encode(uint256(0));
        bytes memory message  = _buildMessage(ONE_USDC, alice, hookData);

        vm.expectRevert(ReceiveMessageFailed.selector);
        sabiBill.payCrossChain(message, bytes(""));
    }
}