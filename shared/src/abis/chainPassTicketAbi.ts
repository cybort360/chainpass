import type { Abi } from "viem";
import artifact from "./chainPassTicket.json" with { type: "json" };

/** Additional entries for USDC payment functions (added without contract recompile). */
const usdcExtensions = [
  // ── State readers ────────────────────────────────────────────────
  { name: "usdcToken",      type: "function", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "address" }] },
  { name: "mintPriceUsdc",  type: "function", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "routeMintPriceUsdc", type: "function", stateMutability: "view",
    inputs: [{ name: "routeId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }] },

  // ── Admin setters ────────────────────────────────────────────────
  { name: "setUsdcToken",      type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }], outputs: [] },
  { name: "setMintPriceUsdc",  type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { name: "setRouteUsdcPrice", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "routeId", type: "uint256" }, { name: "amount", type: "uint256" }], outputs: [] },

  // ── Purchase with USDC ───────────────────────────────────────────
  { name: "purchaseTicketWithUSDC", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "routeId",        type: "uint256" },
      { name: "validUntilEpoch",type: "uint64"  },
      { name: "operatorAddr",   type: "address" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }] },

  // ── Events ───────────────────────────────────────────────────────
  { name: "UsdcTokenSet",      type: "event",
    inputs: [{ name: "token",   type: "address", indexed: true }] },
  { name: "UsdcRoutePriceSet", type: "event",
    inputs: [{ name: "routeId", type: "uint256", indexed: true },
             { name: "amount",  type: "uint256", indexed: false }] },
] as const;

export const chainPassTicketAbi = [...artifact.abi, ...usdcExtensions] as Abi;
