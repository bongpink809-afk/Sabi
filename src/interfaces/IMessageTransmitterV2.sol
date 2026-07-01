// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMessageTransmitterV2 {
    function receiveMessage(
        bytes calldata message,
        bytes calldata attestation
    ) external returns (bool);
}