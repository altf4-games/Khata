// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {KhataRegistry} from "../src/KhataRegistry.sol";

/// Deploys KhataRegistry and registers two signing keys:
///  - NIC's published sample key (kid 4DE1...E301), which verifies the real NIC sample QR.
///  - The labelled "DEMO IRP (not government)" key used for the lifecycle demo.
contract DeployRegistry is Script {
    string internal constant NIC_KID = "4DE1544AE695BDC84EC7BC12F2F57F813F44E301";
    string internal constant DEMO_KID = "DEMO-IRP-NOT-GOVERNMENT-1";
    bytes internal constant EXPONENT = hex"010001";

    function run() external returns (KhataRegistry reg) {
        bytes memory nic = vm.parseBytes(vm.readFile("contracts/test/fixtures/nic-sample.modulus.hex"));
        bytes memory demo = vm.parseBytes(vm.readFile("contracts/test/fixtures/demo-irp/demo-irp.modulus.hex"));

        vm.startBroadcast();
        reg = new KhataRegistry(msg.sender);
        reg.addKey(NIC_KID, nic, EXPONENT, false);
        reg.addKey(DEMO_KID, demo, EXPONENT, true);
        vm.stopBroadcast();

        console.log("KhataRegistry", address(reg));
    }
}
