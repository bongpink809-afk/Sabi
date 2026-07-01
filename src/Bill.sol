// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMessageTransmitterV2} from "./interfaces/IMessageTransmitterV2.sol";

// ─── Lỗi tùy chỉnh ────────────────────────────────────────────────────────────

/// @notice Bill không tồn tại.
error BillNotFound(uint256 billId);

/// @notice Share không tồn tại trong bill.
error ShareNotFound(uint256 billId, uint256 shareId);
// thêm 2 dòng dưới đây:
error InvalidHookData();
error ReceiveMessageFailed();


/// @notice Share đã được thanh toán rồi.
error AlreadyPaid(uint256 billId, uint256 shareId);

/// @notice Số tiền không khớp với share.
error WrongAmount(uint256 billId, uint256 shareId, uint256 got, uint256 expected);

/// @notice Chỉ organizer mới được phép.
error NotOrganizer(uint256 billId);

/// @notice Tham số không hợp lệ khi tạo bill.
error InvalidBillParams();

// ─── Structs & Enums ──────────────────────────────────────────────────────────

enum BillMode { ASSIGNED, OPEN_SLOT }

struct Share {
    address assignedWallet; // chỉ dùng cho ASSIGNED mode (hiển thị UI), không enforce khi pay
    uint256 amount;
    bool    paid;
}

struct Bill {
    address  organizer;
    BillMode mode;
    uint256  totalAmount;
    // OPEN_SLOT
    uint256 amountPerSlot;
    uint256 numSlots;
    uint256 matchedSlotsCount;
    uint256 extraReceived;
}

// ─── Events ───────────────────────────────────────────────────────────────────

/// @notice Phát ra khi tạo bill mới.
event BillCreated(uint256 indexed billId, address indexed organizer, BillMode mode, uint256 totalAmount);

/// @notice Phát ra khi 1 share được thanh toán (ASSIGNED mode).
event SharePaid(uint256 indexed billId, uint256 indexed shareId, address payer, uint256 amount);

/// @notice Phát ra khi nhận tiền (OPEN_SLOT mode).
event SlotFilled(uint256 indexed billId, address payer, uint256 amount, bool matched);

/// @title Bill
/// @notice Phase 2 — Bill contract lõi, thanh toán trực tiếp trên Arc.
///         Tiền đi thẳng từ người trả đến organizer, không giữ lại trong contract.
contract SabiBill {
    IERC20 public immutable usdc;
    IMessageTransmitterV2 public immutable messageTransmitter;

    uint256 private _nextBillId;

    mapping(uint256 => Bill)                      public bills;
    mapping(uint256 => mapping(uint256 => Share)) public shares;   // billId → shareId → Share
    mapping(uint256 => uint256)                   public shareCount; // billId → số share

    constructor(address usdc_, address messageTransmitter_) {
    usdc = IERC20(usdc_);
    messageTransmitter = IMessageTransmitterV2(messageTransmitter_);
}
    

    // ─── Tạo bill ─────────────────────────────────────────────────────────────

    /// @notice Tạo bill ASSIGNED — danh sách người + wallet + amount cụ thể.
    /// @param assignedWallets danh sách ví (chỉ để hiển thị, không enforce khi pay)
    /// @param amounts         số tiền tương ứng mỗi người
    function createAssignedBill(
        address[] calldata assignedWallets,
        uint256[] calldata amounts
    ) external returns (uint256 billId) {
        if (assignedWallets.length == 0 || assignedWallets.length != amounts.length)
            revert InvalidBillParams();

        billId = _nextBillId++;

        uint256 total;
        for (uint256 i; i < amounts.length; ++i) {
            if (amounts[i] == 0) revert InvalidBillParams();
            shares[billId][i] = Share({
                assignedWallet: assignedWallets[i],
                amount:         amounts[i],
                paid:           false
            });
            total += amounts[i];
        }

        shareCount[billId] = assignedWallets.length;

        bills[billId] = Bill({
            organizer:         msg.sender,
            mode:              BillMode.ASSIGNED,
            totalAmount:       total,
            amountPerSlot:     0,
            numSlots:          0,
            matchedSlotsCount: 0,
            extraReceived:     0
        });

        emit BillCreated(billId, msg.sender, BillMode.ASSIGNED, total);
    }

    /// @notice Tạo bill OPEN_SLOT — tổng tiền + số người, không gắn wallet cụ thể.
    /// @param amountPerSlot số tiền mỗi người cần trả
    /// @param numSlots      số người
    function createOpenSlotBill(
        uint256 amountPerSlot,
        uint256 numSlots
    ) external returns (uint256 billId) {
        if (amountPerSlot == 0 || numSlots == 0) revert InvalidBillParams();

        billId = _nextBillId++;

        bills[billId] = Bill({
            organizer:         msg.sender,
            mode:              BillMode.OPEN_SLOT,
            totalAmount:       amountPerSlot * numSlots,
            amountPerSlot:     amountPerSlot,
            numSlots:          numSlots,
            matchedSlotsCount: 0,
            extraReceived:     0
        });

        emit BillCreated(billId, msg.sender, BillMode.OPEN_SLOT, amountPerSlot * numSlots);
    }

    // ─── Thanh toán ───────────────────────────────────────────────────────────

    /// @notice Trả tiền cho 1 share (ASSIGNED mode).
    ///         Ai gọi cũng được — không check msg.sender, chỉ check amount.
    ///         Tiền đi thẳng từ msg.sender đến organizer, không qua contract.
    function payShare(uint256 billId, uint256 shareId) external {
        Bill storage bill = _getBill(billId);
        if (bill.mode != BillMode.ASSIGNED) revert InvalidBillParams();

        Share storage share = _getShare(billId, shareId);
        if (share.paid) revert AlreadyPaid(billId, shareId);

        uint256 amount = share.amount;
        share.paid = true;

        // tiền đi thẳng msg.sender → organizer, không giữ trong contract
        require(usdc.transferFrom(msg.sender, bill.organizer, amount), "transfer failed");

        emit SharePaid(billId, shareId, msg.sender, amount);
    }

    /// @notice Trả tiền vào bill OPEN_SLOT.
    ///         Nhận bất kỳ amount nào — đếm matched nếu đúng amountPerSlot,
    ///         cộng extraReceived nếu sai. Không giới hạn số lần gọi.
    function paySlot(uint256 billId, uint256 amount) external {
        Bill storage bill = _getBill(billId);
        if (bill.mode != BillMode.OPEN_SLOT) revert InvalidBillParams();
        if (amount == 0) revert InvalidBillParams();

        bool matched = (amount == bill.amountPerSlot);
        if (matched) {
            bill.matchedSlotsCount++;
        } else {
            bill.extraReceived += amount;
        }

        // tiền đi thẳng msg.sender → organizer, không giữ trong contract
        require(usdc.transferFrom(msg.sender, bill.organizer, amount), "transfer failed");
        emit SlotFilled(billId, msg.sender, amount, matched);
    }

    /// @notice Nhận USDC cross-chain qua CCTP V2 và ghi nhận thanh toán trong cùng 1 tx.
    /// @dev Ai cũng gọi được — permissionless như receiveMessage vốn vậy.
    ///      hookData encode: ASSIGNED = abi.encode(billId, shareId), OPEN_SLOT = abi.encode(billId)
    ///      message body offsets (BurnMessageV2, verified từ Phase 1):
    ///        OFFSET_AMOUNT=68, OFFSET_MESSAGE_SENDER=100, OFFSET_HOOK_DATA=228
    ///      messageBody = message[148:] (MessageV2 header = 148 bytes, verified on-chain)
    function payCrossChain(
        bytes calldata message,
        bytes calldata attestation
        ) external {
        // 1. Gọi receiveMessage — mint USDC vào địa chỉ này (mintRecipient = address(this))
        bool ok = messageTransmitter.receiveMessage(message, attestation);
        if (!ok) revert ReceiveMessageFailed();

        // 2. Extract messageBody từ full message (skip 148-byte MessageV2 header)
        bytes calldata messageBody = message[148:];

        // 3. Decode các field cần thiết từ BurnMessageV2
        uint256 amount        = uint256(bytes32(messageBody[68:100]));
        bytes32 messageSender = bytes32(messageBody[100:132]);
        bytes calldata hookData = messageBody[228:];

        // 4. Decode billId từ hookData (luôn có ở cả 2 mode)
        if (hookData.length < 32) revert InvalidHookData();
        uint256 billId = abi.decode(hookData[:32], (uint256));

        Bill storage b = _getBill(billId);

        if (b.mode == BillMode.ASSIGNED) {
            // ASSIGNED: cần thêm shareId
            if (hookData.length < 64) revert InvalidHookData();
            uint256 shareId = abi.decode(hookData[32:64], (uint256));

            Share storage share = _getShare(billId, shareId);
            if (share.paid) revert AlreadyPaid(billId, shareId);
            if (amount != share.amount) revert WrongAmount(billId, shareId, amount, share.amount);

            share.paid = true;

            // forward USDC đến organizer ngay trong cùng tx
            require(usdc.transfer(b.organizer, amount), "transfer failed");
            emit SharePaid(billId, shareId, address(uint160(uint256(messageSender))), amount);

        } else {
            // OPEN_SLOT: chỉ cần billId
            bool matched = (amount == b.amountPerSlot);
            if (matched) {
                b.matchedSlotsCount++;
            } else {
                b.extraReceived += amount;
            }

            require(usdc.transfer(b.organizer, amount), "transfer failed");
            emit SlotFilled(billId, address(uint160(uint256(messageSender))), amount, matched);
        }
    }   

    // ─── View ─────────────────────────────────────────────────────────────────

    /// @notice Lấy thông tin bill.
    function getBill(uint256 billId) external view returns (Bill memory) {
        return _getBill(billId);
    }

    /// @notice Lấy thông tin 1 share.
    function getShare(uint256 billId, uint256 shareId) external view returns (Share memory) {
        return _getShare(billId, shareId);
    }

    /// @notice Số bill đã tạo.
    function nextBillId() external view returns (uint256) {
        return _nextBillId;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _getBill(uint256 billId) internal view returns (Bill storage) {
        if (billId >= _nextBillId) revert BillNotFound(billId);
        return bills[billId];
    }

    function _getShare(uint256 billId, uint256 shareId) internal view returns (Share storage) {
        if (shareId >= shareCount[billId]) revert ShareNotFound(billId, shareId);
        return shares[billId][shareId];
    }
}