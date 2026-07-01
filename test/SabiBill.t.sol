// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SabiBill, BillMode, Share, Bill, InvalidBillParams, AlreadyPaid, WrongAmount, BillNotFound, ShareNotFound, SharePaid, SlotFilled, BillCreated} from "../src/Bill.sol";

/// @notice Mock USDC đơn giản — mint tùy ý, track transferFrom
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

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient balance");
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        balanceOf[from] -= amount;
        allowance[from][msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract SabiBillTest is Test {
    SabiBill bill;
    MockUSDC usdc;

    address organizer = address(0x1111);
    address alice     = address(0x2222);
    address bob       = address(0x3333);
    address stranger  = address(0x4444);

    uint256 constant ONE_USDC  = 1_000_000;
    uint256 constant TWO_USDC  = 2_000_000;

    function setUp() public {
        usdc = new MockUSDC();
        bill = new SabiBill(address(usdc), address(0)); // Phase 2 test không dùng CCTP

        // Cấp USDC và approve cho alice, bob, stranger
        usdc.mint(alice,    10 * ONE_USDC);
        usdc.mint(bob,      10 * ONE_USDC);
        usdc.mint(stranger, 10 * ONE_USDC);

        vm.prank(alice);
        usdc.approve(address(bill), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(bill), type(uint256).max);
        vm.prank(stranger);
        usdc.approve(address(bill), type(uint256).max);
    }

    // ─── ASSIGNED mode ────────────────────────────────────────────────────────

    function test_Assigned_CreateBill() public {
        address[] memory wallets = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        wallets[0] = alice; wallets[1] = bob;
        amounts[0] = ONE_USDC; amounts[1] = TWO_USDC;

        vm.prank(organizer);
        vm.expectEmit(true, true, false, true, address(bill));
        emit BillCreated(0, organizer, BillMode.ASSIGNED, ONE_USDC + TWO_USDC);
        uint256 billId = bill.createAssignedBill(amounts);

        assertEq(billId, 0);
        Bill memory b = bill.getBill(0);
        assertEq(b.organizer, organizer);
        assertEq(uint8(b.mode), uint8(BillMode.ASSIGNED));
        assertEq(b.totalAmount, ONE_USDC + TWO_USDC);
    }

    function test_Assigned_PayShare_AnyCallerOk() public {
    uint256[] memory amounts = new uint256[](1);
    amounts[0] = ONE_USDC;

    vm.prank(organizer);
    bill.createAssignedBill(amounts);

    uint256 orgBefore = usdc.balanceOf(organizer);

    vm.prank(stranger);
    vm.expectEmit(true, true, false, true, address(bill));
    emit SharePaid(0, 0, stranger, ONE_USDC);
    bill.payShare(0, 0);

    assertEq(usdc.balanceOf(organizer), orgBefore + ONE_USDC);
    assertTrue(bill.getShare(0, 0).paid);
}

    function test_Assigned_AlreadyPaid_Reverts() public {
        address[] memory wallets = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        wallets[0] = alice;
        amounts[0] = ONE_USDC;

        vm.prank(organizer);
        bill.createAssignedBill(amounts);

        vm.prank(alice);
        bill.payShare(0, 0);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(AlreadyPaid.selector, 0, 0));
        bill.payShare(0, 0);
    }

    function test_Assigned_InvalidParams_Reverts() public {
    uint256[] memory amounts = new uint256[](0); // mảng rỗng

    vm.prank(organizer);
    vm.expectRevert(InvalidBillParams.selector);
    bill.createAssignedBill(amounts);
}


    function test_Assigned_BillNotFound_Reverts() public {
        vm.expectRevert(abi.encodeWithSelector(BillNotFound.selector, 99));
        bill.payShare(99, 0);
    }

    // ─── OPEN_SLOT mode ───────────────────────────────────────────────────────

    function test_OpenSlot_CreateBill() public {
        vm.prank(organizer);
        vm.expectEmit(true, true, false, true, address(bill));
        emit BillCreated(0, organizer, BillMode.OPEN_SLOT, ONE_USDC * 3);
        uint256 billId = bill.createOpenSlotBill(ONE_USDC, 3);

        assertEq(billId, 0);
        Bill memory b = bill.getBill(0);
        assertEq(b.amountPerSlot, ONE_USDC);
        assertEq(b.numSlots, 3);
        assertEq(b.totalAmount, ONE_USDC * 3);
    }

    function test_OpenSlot_PayExactAmount_Matched() public {
        vm.prank(organizer);
        bill.createOpenSlotBill(ONE_USDC, 3);

        uint256 orgBefore = usdc.balanceOf(organizer);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true, address(bill));
        emit SlotFilled(0, alice, ONE_USDC, true);
        bill.paySlot(0, ONE_USDC);

        assertEq(usdc.balanceOf(organizer), orgBefore + ONE_USDC);
        assertEq(bill.getBill(0).matchedSlotsCount, 1);
        assertEq(bill.getBill(0).extraReceived, 0);
    }

    function test_OpenSlot_PayWrongAmount_Extra() public {
        vm.prank(organizer);
        bill.createOpenSlotBill(ONE_USDC, 3);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true, address(bill));
        emit SlotFilled(0, alice, TWO_USDC, false);
        bill.paySlot(0, TWO_USDC);

        assertEq(bill.getBill(0).matchedSlotsCount, 0);
        assertEq(bill.getBill(0).extraReceived, TWO_USDC);
    }

    function test_OpenSlot_PayAfterFull_StillAccepted() public {
        vm.prank(organizer);
        bill.createOpenSlotBill(ONE_USDC, 1);

        // trả đủ 1 slot
        vm.prank(alice);
        bill.paySlot(0, ONE_USDC);
        assertEq(bill.getBill(0).matchedSlotsCount, 1);

        // trả thêm sau khi đủ — vẫn nhận được (như STK ngân hàng)
        vm.prank(bob);
        bill.paySlot(0, ONE_USDC);
        assertEq(bill.getBill(0).matchedSlotsCount, 2);
    }

    function test_OpenSlot_InvalidParams_Reverts() public {
        vm.prank(organizer);
        vm.expectRevert(InvalidBillParams.selector);
        bill.createOpenSlotBill(0, 3); // amountPerSlot = 0
    }

    function test_OpenSlot_WrongMode_Reverts() public {
        // tạo ASSIGNED bill rồi gọi paySlot → revert
        address[] memory wallets = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        wallets[0] = alice; amounts[0] = ONE_USDC;
        vm.prank(organizer);
        bill.createAssignedBill(amounts);

        vm.prank(alice);
        vm.expectRevert(InvalidBillParams.selector);
        bill.paySlot(0, ONE_USDC);
    }
}