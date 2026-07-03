// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {BillHookReceiver} from "../src/BillHookReceiver.sol";

contract DeployBillHookReceiver is Script {
    function run() external {
        // Đọc config từ .env — tất cả đều bắt buộc, script revert nếu thiếu
        address expectedSender     = vm.envAddress("EXPECTED_SENDER");
        uint256 expectedAmount     = vm.envUint("EXPECTED_AMOUNT");
        address messageTransmitter = vm.envAddress("ARC_MSG_TRANSMITTER");
        address usdc               = vm.envAddress("ARC_USDC");

        vm.startBroadcast();
        BillHookReceiver hook = new BillHookReceiver(
            expectedSender,
            expectedAmount,
            messageTransmitter,
            usdc
        );
        vm.stopBroadcast();

        console.log("BillHookReceiver deployed at:", address(hook));
        console.log("  expectedSender:     ", expectedSender);
        console.log("  expectedAmount:     ", expectedAmount);
        console.log("  messageTransmitter: ", messageTransmitter);
        console.log("  usdc:               ", usdc);
    }
}