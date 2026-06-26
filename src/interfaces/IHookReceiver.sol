// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Interface mà CCTP V2 MessageTransmitter gọi trên contract nhận hook.
interface IHookReceiver {
    /// @notice Được gọi bởi MessageTransmitter sau khi một cross-chain message đã finalized.
    /// @param sourceDomain               CCTP domain ID của chain nguồn (ví dụ: 6 = Base).
    /// @param sender                     Địa chỉ TokenMessenger trên chain nguồn, dạng bytes32.
    ///                                   KHÔNG phải ví người dùng — ví người dùng nằm trong messageBody.
    /// @param finalityThresholdExecuted  Ngưỡng finality mà message này được attest.
    /// @param messageBody                BurnMessageV2 payload. Giải mã theo byte offset cố định.
    /// @return                           true nếu xử lý thành công (confirmed: IMessageHandlerV2.sol returns bool).
    function handleReceiveFinalizedMessage(
        uint32 sourceDomain,
        bytes32 sender,
        uint32 finalityThresholdExecuted,
        bytes calldata messageBody
    ) external returns (bool);
}
