// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ChainPassTicket} from "../src/ChainPassTicket.sol";

/// @notice Configure USDC payment on a deployed ChainPassTicket.
///
/// Required env vars (set in contracts/.env):
///   PRIVATE_KEY            — admin wallet private key (uint256)
///   CONTRACT_ADDRESS       — deployed ChainPassTicket address
///   USDC_TOKEN             — USDC ERC-20 address on this chain
///   USDC_PRICE             — default price in USDC (6 decimals, e.g. 100000 = $0.10)
///
/// Optional per-route overrides (comma-separated, same order):
///   USDC_ROUTE_IDS         — e.g. "12345,67890"
///   USDC_ROUTE_PRICES      — e.g. "75000,150000"
///
/// Run:
///   forge script script/ConfigureUsdc.s.sol --rpc-url $RPC_URL --broadcast -vvv
contract ConfigureUsdc is Script {
    function run() external {
        uint256 pk         = vm.envUint("PRIVATE_KEY");
        address contract_  = vm.envAddress("CONTRACT_ADDRESS");
        address usdcToken  = vm.envAddress("USDC_TOKEN");
        uint256 usdcPrice  = vm.envUint("USDC_PRICE");

        ChainPassTicket ticket = ChainPassTicket(contract_);

        vm.startBroadcast(pk);

        ticket.setUsdcToken(usdcToken);
        console2.log("setUsdcToken =>", usdcToken);

        ticket.setMintPriceUsdc(usdcPrice);
        console2.log("setMintPriceUsdc => %d (%s USDC)", usdcPrice, _fmtUsdc(usdcPrice));

        // Optional per-route overrides
        string memory routeIdsRaw   = vm.envOr("USDC_ROUTE_IDS",   string(""));
        string memory routePricesRaw = vm.envOr("USDC_ROUTE_PRICES", string(""));

        if (bytes(routeIdsRaw).length > 0 && bytes(routePricesRaw).length > 0) {
            uint256[] memory ids    = _parseUintList(routeIdsRaw);
            uint256[] memory prices = _parseUintList(routePricesRaw);
            require(ids.length == prices.length, "ConfigureUsdc: ids/prices length mismatch");

            for (uint256 i = 0; i < ids.length; i++) {
                ticket.setRouteUsdcPrice(ids[i], prices[i]);
                console2.log("  setRouteUsdcPrice routeId=%d => %d (%s USDC)", ids[i], prices[i], _fmtUsdc(prices[i]));
            }
        }

        vm.stopBroadcast();

        console2.log("\nDone. USDC payments are now enabled on:", contract_);
    }

    /// @dev Crude comma-separated uint256 list parser (no spaces).
    function _parseUintList(string memory s) internal pure returns (uint256[] memory) {
        bytes memory b = bytes(s);
        uint256 count = 1;
        for (uint256 i = 0; i < b.length; i++) if (b[i] == ",") count++;

        uint256[] memory result = new uint256[](count);
        uint256 idx;
        uint256 cur;
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] == ",") { result[idx++] = cur; cur = 0; }
            else { cur = cur * 10 + (uint8(b[i]) - 48); }
        }
        result[idx] = cur;
        return result;
    }

    /// @dev Format 6-decimal USDC amount as "X.XX".
    function _fmtUsdc(uint256 amount) internal pure returns (string memory) {
        uint256 whole = amount / 1e6;
        uint256 frac  = (amount % 1e6) / 1e4; // two decimal places
        return string(abi.encodePacked(
            vm.toString(whole), ".",
            frac < 10 ? "0" : "", vm.toString(frac)
        ));
    }
}
