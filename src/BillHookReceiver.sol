// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IHookReceiver} from "./interfaces/IHookReceiver.sol";

// ─── Lỗi tùy chỉnh ────────────────────────────────────────────────────────────

/// @notice messageSender trong BurnMessageV2 không khớp với địa chỉ kỳ vọng.
error WrongSender(bytes32 got, bytes32 expected);

/// @notice amount trong BurnMessageV2 không khớp với số tiền kỳ vọng.
error WrongAmount(uint256 got, uint256 expected);

/// @notice Caller không phải MessageTransmitter được phép.
error UnauthorizedCaller(address caller);

// ─── Events ───────────────────────────────────────────────────────────────────

/// @notice Phát ra khi BurnMessageV2 giải mã thành công và qua xác thực.
event HookValidated(bytes32 indexed messageSender, uint256 amount, bytes hookData);

/// @notice Phát ra raw messageBody để so sánh offset khi test với burn thật.
///         TODO: xóa trước Phase 3 — chỉ dùng ở Phase 1.
event DebugMessageBody(bytes messageBody);

// ─── BurnMessageV2 byte offsets ───────────────────────────────────────────────
//
// Nguồn: Circle CCTP V2 whitepaper. CHƯA xác minh với dữ liệu thực tế.
// TODO (Phase 3 gate): lấy một messageBody thực từ giao dịch burn trên Base Sepolia,
//      decode thủ công tại các offset 68, 100, 168, so sánh với các trường thực tế.
//      Nếu sai → cập nhật các hằng số dưới đây rồi chạy lại test.
//      Rủi ro cụ thể: OFFSET_HOOK_DATA có thể là 172 thay vì 168 nếu Circle
//      chèn thêm 4 byte hookDataOffset tại vị trí 168–171.
//
//  Offset  Size  Field
//  0       4     version (uint32)
//  4       32    burnToken (bytes32)
//  36      32    mintRecipient (bytes32)
//  68      32    amount (uint256)
//  100     32    messageSender (bytes32)   ← ví người dùng
//  132     32    maxFee (uint256)          — V2 only
//  164     4     minFinalityThreshold (uint32) — V2 only
//  168+    var   hookData

/// @title BillHookReceiver
/// @notice Phase 1 — isolated CCTP V2 hook receiver.
///         Mục đích duy nhất: giải mã BurnMessageV2, xác thực messageSender và amount,
///         và phát sự kiện. Không có logic nghiệp vụ nào khác, không chuyển tiền.
///         Dùng để xác minh byte offset trước khi tích hợp vào Bill contract ở Phase 3.
contract BillHookReceiver is IHookReceiver {
    /// @notice Địa chỉ ví người dùng kỳ vọng (bytes32), so sánh với messageSender trong BurnMessageV2.
    bytes32 public immutable expectedSender;

    /// @notice Số tiền USDC kỳ vọng (6 decimals), so sánh với amount trong BurnMessageV2.
    uint256 public immutable expectedAmount;

    /// @notice Chỉ địa chỉ này mới được phép gọi handleReceiveFinalizedMessage.
    address public immutable messageTransmitter;

    /// @notice Địa chỉ USDC trên Arc Testnet. Lưu để xác nhận config đúng mạng; Phase 1 không dùng.
    address public immutable usdc;

    uint256 private constant OFFSET_AMOUNT         = 68;
    uint256 private constant OFFSET_MESSAGE_SENDER = 100;
    uint256 private constant OFFSET_HOOK_DATA      = 168; // TODO: xác minh — có thể là 172

    /// @param messageSender_      Ví người dùng kỳ vọng (address, tự động chuyển sang bytes32).
    /// @param amount_             Số tiền USDC kỳ vọng.
    /// @param messageTransmitter_ Địa chỉ MessageTransmitter của CCTP V2 trên Arc Testnet.
    /// @param usdc_               Địa chỉ USDC trên Arc Testnet (0x3600...0000).
    constructor(
        address messageSender_,
        uint256 amount_,
        address messageTransmitter_,
        address usdc_
    ) {
        expectedSender = bytes32(uint256(uint160(messageSender_)));
        expectedAmount = amount_;
        messageTransmitter = messageTransmitter_;
        usdc = usdc_;
    }

    /// @inheritdoc IHookReceiver
    /// @dev Kiểm tra sender trước, amount sau. Nếu cả hai sai thì revert WrongSender.
    function handleReceiveFinalizedMessage(
        uint32, /* sourceDomain */
        bytes32, /* sender — là TokenMessenger, không phải ví người dùng */
        uint32, /* finalityThresholdExecuted */
        bytes calldata messageBody
    ) external override returns (bytes4) {
        if (msg.sender != messageTransmitter) revert UnauthorizedCaller(msg.sender);

        emit DebugMessageBody(messageBody); // TODO: xóa trước Phase 3

        bytes32 msgSender = _readBytes32(messageBody, OFFSET_MESSAGE_SENDER);
        uint256 amount    = _readUint256(messageBody, OFFSET_AMOUNT);

        if (msgSender != expectedSender) revert WrongSender(msgSender, expectedSender);
        if (amount    != expectedAmount) revert WrongAmount(amount,    expectedAmount);

        // PHASE 3 MANDATORY — chèn check AlreadyPaid tại đây trước khi forward tiền:
        //
        //   if (share.paid) revert AlreadyPaid(billId, shareId);
        //   share.paid = true;
        //
        // Lý do bắt buộc: CCTP nonce bitmap chỉ chặn relay lại đúng cùng 1 message.
        // Nó KHÔNG chặn trường hợp người dùng thực hiện 2 burn riêng biệt (2 nonce khác nhau)
        // cùng trỏ vào 1 billId/shareId — cả 2 đều có attestation hợp lệ, cả 2 đều qua
        // được MessageTransmitter. AlreadyPaid là lớp bảo vệ DUY NHẤT cho case này.
        // Test "gọi hook 2 lần cho cùng share, lần 2 revert AlreadyPaid" là BẮTBUỘC ở Phase 3,
        // không phải optional.

        bytes memory hookData = messageBody[OFFSET_HOOK_DATA:];

        emit HookValidated(msgSender, amount, hookData);
        return IHookReceiver.handleReceiveFinalizedMessage.selector;
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    /// @dev Đọc bytes32 tại `offset` trong calldata slice `data`.
    function _readBytes32(bytes calldata data, uint256 offset)
        internal
        pure
        returns (bytes32 value)
    {
        // BurnMessageV2 không phải ABI-encoded — phải dùng calldataload trực tiếp.
        assembly {
            value := calldataload(add(data.offset, offset))
        }
    }

    /// @dev Đọc uint256 tại `offset`. uint256 và bytes32 cùng kích thước 32 byte.
    function _readUint256(bytes calldata data, uint256 offset)
        internal
        pure
        returns (uint256)
    {
        return uint256(_readBytes32(data, offset));
    }
}
