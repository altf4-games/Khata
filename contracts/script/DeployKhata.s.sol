// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AttesterRegistry} from "../src/AttesterRegistry.sol";
import {KhataRegistry} from "../src/KhataRegistry.sol";
import {KhataFactory} from "../src/KhataFactory.sol";

/// Deploys the whole system on Whitechain Sepolia against the prize USDT.
/// Env: DEMO_ATTESTER_ADDRESS (the labelled demo attester), COOL_OFF_SECONDS (live demo uses a short value;
/// the contract is tested with 24 h), MICRO_USDT_PER_PAISA (fixed demo rate, default 1).
contract DeployKhata is Script {
    address internal constant USDT = 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7;
    string internal constant NIC_KID = "4DE1544AE695BDC84EC7BC12F2F57F813F44E301";
    string internal constant DEMO_KID = "DEMO-IRP-NOT-GOVERNMENT-1";
    bytes internal constant EXPONENT = hex"010001";

    function run() external returns (AttesterRegistry attesters, KhataRegistry registry, KhataFactory factory) {
        address demoAttester = vm.envAddress("DEMO_ATTESTER_ADDRESS");
        uint64 coolOff = uint64(vm.envOr("COOL_OFF_SECONDS", uint256(60)));
        uint256 rate = vm.envOr("MICRO_USDT_PER_PAISA", uint256(1));

        bytes memory nic = vm.parseBytes(vm.readFile("contracts/test/fixtures/nic-sample.modulus.hex"));
        bytes memory demo = vm.parseBytes(vm.readFile("contracts/test/fixtures/demo-irp/demo-irp.modulus.hex"));

        vm.startBroadcast();
        attesters = new AttesterRegistry(msg.sender);
        attesters.addAttester(demoAttester);
        registry = new KhataRegistry(msg.sender, attesters, coolOff);
        registry.addKey(NIC_KID, nic, EXPONENT, false);
        registry.addKey(DEMO_KID, demo, EXPONENT, true);
        factory = new KhataFactory(IERC20(USDT), registry, attesters, rate);
        vm.stopBroadcast();

        console.log("AttesterRegistry", address(attesters));
        console.log("KhataRegistry", address(registry));
        console.log("KhataFactory", address(factory));
    }
}
