// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SabiBill, BillMode, Bill, Share, InvalidHookData, ReceiveMessageFailed, AlreadyPaid, WrongAmount, SharePaid, SlotFilled} from "../src/Bill.sol";

/// @notice Mock USDC — transmitter sẽ mint vào SabiBill ngay trong receiveMessage
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

/// @notice Mock MessageTransmitterV2 — hành xử như transmitter thật:
/// tự decode amount từ message rồi MINT NGAY trong receiveMessage.
/// fee > 0 mô phỏng Fast Transfer (Circle trừ fee vào số mint),
/// fee = 0 mô phỏng Standard Transfer.
contract MockMessageTransmitter {
    MockUSDC public usdc;
    bool public shouldFail;
    uint256 public fee; // mặc định 0 = Standard Transfer

    constructor(address usdc_) {
        usdc = MockUSDC(usdc_);
    }

    function setShouldFail(bool fail) external {
        shouldFail = fail;
    }

    function setFee(uint256 fee_) external {
        fee = fee_;
    }

    function receiveMessage(
        bytes calldata message,
        bytes calldata /* attestation */
    ) external returns (bool) {
        if (shouldFail) return false;

        // Decode amount từ message giống transmitter thật:
        // 148 bytes MessageV2 header + offset 68 trong body = 216
        uint256 amount = uint256(bytes32(message[216:248]));

        // Mint (amount - fee) vào msg.sender (= SabiBill) — đúng hành vi CCTP:
        // Fast Transfer bị trừ fee thẳng vào số USDC mint ở chain đích
        usdc.mint(msg.sender, amount - fee);
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
    uint256 constant FAST_FEE = 100; // 0.0001 USDC — mô phỏng fee Fast Transfer

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
        uint256 billId = sabiBill.createAssignedBill(amounts);

        // Không mint trước nữa — transmitter tự mint trong receiveMessage
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
        uint256 billId = sabiBill.createAssignedBill(amounts);

        // Lần 1 — thành công (transmitter tự mint)
        bytes memory hookData = abi.encode(billId, uint256(0));
        bytes memory message  = _buildMessage(ONE_USDC, alice, hookData);
        sabiBill.payCrossChain(message, bytes(""));

        // Lần 2 — revert AlreadyPaid
        vm.expectRevert(abi.encodeWithSelector(AlreadyPaid.selector, billId, 0));
        sabiBill.payCrossChain(message, bytes(""));
    }

    function test_CrossChain_Assigned_WrongAmount_Reverts() public {
        address[] memory wallets = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        wallets[0] = alice;
        amounts[0] = ONE_USDC;
        vm.prank(organizer);
        uint256 billId = sabiBill.createAssignedBill(amounts);

        bytes memory hookData = abi.encode(billId, uint256(0));
        bytes memory message  = _buildMessage(500_000, alice, hookData); // sai amount

        vm.expectRevert(abi.encodeWithSelector(WrongAmount.selector, billId, 0, 500_000, ONE_USDC));
        sabiBill.payCrossChain(message, bytes(""));
    }

    // ─── ASSIGNED mode — Fast Transfer (fee > 0) ─────────────────────────────

    function test_CrossChain_Assigned_FastTransfer_FeeDeducted() public {
        address[] memory wallets = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        wallets[0] = alice;
        amounts[0] = ONE_USDC;
        vm.prank(organizer);
        uint256 billId = sabiBill.createAssignedBill(amounts);

        // Bật fee — mô phỏng Fast Transfer: mint chỉ (amount - fee)
        transmitter.setFee(FAST_FEE);

        bytes memory hookData = abi.encode(billId, uint256(0));
        bytes memory message  = _buildMessage(ONE_USDC, alice, hookData);

        uint256 orgBefore = usdc.balanceOf(organizer);

        // Event vẫn emit amount ĐẦY ĐỦ (số người trả đã burn)
        vm.expectEmit(true, true, false, true, address(sabiBill));
        emit SharePaid(billId, 0, alice, ONE_USDC);
        sabiBill.payCrossChain(message, bytes(""));

        // Organizer nhận đúng số THỰC MINT = amount - fee (không revert vì thiếu tiền)
        assertEq(usdc.balanceOf(organizer), orgBefore + ONE_USDC - FAST_FEE);
        // Share vẫn được đánh dấu paid — check amount so với số đã burn, không phải số nhận
        assertTrue(sabiBill.getShare(billId, 0).paid);
        // Contract không giữ lại đồng nào (no custody)
        assertEq(usdc.balanceOf(address(sabiBill)), 0);
    }

    // ─── OPEN_SLOT mode ───────────────────────────────────────────────────────

    function test_CrossChain_OpenSlot_Matched() public {
        vm.prank(organizer);
        uint256 billId = sabiBill.createOpenSlotBill(ONE_USDC, 3);

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
        bytes memory hookData = abi.encode(billId);
        bytes memory message  = _buildMessage(wrongAmount, alice, hookData);

        sabiBill.payCrossChain(message, bytes(""));

        assertEq(sabiBill.getBill(billId).matchedSlotsCount, 0);
        assertEq(sabiBill.getBill(billId).extraReceived, wrongAmount);
    }

    // ─── OPEN_SLOT mode — Fast Transfer (fee > 0) ────────────────────────────

    function test_CrossChain_OpenSlot_FastTransfer_FeeDeducted() public {
        vm.prank(organizer);
        uint256 billId = sabiBill.createOpenSlotBill(ONE_USDC, 3);

        transmitter.setFee(FAST_FEE);

        bytes memory hookData = abi.encode(billId);
        bytes memory message  = _buildMessage(ONE_USDC, alice, hookData);

        uint256 orgBefore = usdc.balanceOf(organizer);

        sabiBill.payCrossChain(message, bytes(""));

        // matched vẫn true — so amount (số đã burn) với amountPerSlot
        assertEq(sabiBill.getBill(billId).matchedSlotsCount, 1);
        // Organizer nhận số thực mint = amount - fee
        assertEq(usdc.balanceOf(organizer), orgBefore + ONE_USDC - FAST_FEE);
        assertEq(usdc.balanceOf(address(sabiBill)), 0);
    }

    // ─── Edge cases ───────────────────────────────────────────────────────────

    function test_CrossChain_InvalidHookData_Reverts() public {
        vm.prank(organizer);
        sabiBill.createOpenSlotBill(ONE_USDC, 1);

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
