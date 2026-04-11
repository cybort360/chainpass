// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {ChainPassTicket} from "../src/ChainPassTicket.sol";

/// @notice Deploy `ChainPassTicket` and grant minter/burner roles.
/// @dev Required env: `PRIVATE_KEY` (uint256). Optional: `MINTER_ADDRESS`, `BURNER_ADDRESS` (default: deployer).
///      Optional: `METADATA_BASE_URI` (default empty), `TREASURY_ADDRESS` (default deployer), `MINT_PRICE_WEI` (default 0).
///      Per-route prices: after deploy, run repo root `pnpm sync-route-prices` (reads config/nigeria-routes.json) or call `setRouteMintPrice` / `cast send` as admin.
contract DeployChainPass is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address minter = vm.envOr("MINTER_ADDRESS", deployer);
        address burner = vm.envOr("BURNER_ADDRESS", deployer);
        string memory baseURI = vm.envOr("METADATA_BASE_URI", string(""));
        address payable treasury = payable(vm.envOr("TREASURY_ADDRESS", deployer));
        uint256 mintPriceWei = vm.envOr("MINT_PRICE_WEI", uint256(0));

        vm.startBroadcast(pk);

        ChainPassTicket ticket = new ChainPassTicket(deployer, baseURI, treasury, mintPriceWei);

        ticket.grantRole(ticket.MINTER_ROLE(), minter);
        ticket.grantRole(ticket.BURNER_ROLE(), burner);

        vm.stopBroadcast();

        console2.log("ChainPassTicket:", address(ticket));
        console2.log("admin (DEFAULT_ADMIN):", deployer);
        console2.log("treasury:", treasury);
        console2.log("mintPriceWei:", mintPriceWei);
        console2.log("MINTER_ROLE granted to:", minter);
        console2.log("BURNER_ROLE granted to:", burner);
    }
}
