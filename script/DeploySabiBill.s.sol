// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {SabiBill} from "../src/Bill.sol";

contract DeploySabiBill is Script {
    function run() external {
        address usdc               = 0x3600000000000000000000000000000000000000;
        address messageTransmitter = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;

        vm.startBroadcast();
        SabiBill sabi = new SabiBill(usdc, messageTransmitter);
        vm.stopBroadcast();

        console.log("SabiBill deployed at:", address(sabi));
        console.log("  usdc:               ", usdc);
        console.log("  messageTransmitter: ", messageTransmitter);
    }
}