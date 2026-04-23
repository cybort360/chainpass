import { v4 as uuidv4, v5 as uuidv5 } from "uuid";
import { keccak256, stringToBytes } from "viem";

/**
 * Fixed namespace for UUID v5 — deterministic ids for demo/config rows (category + name).
 * (RFC 4122 namespace UUID; not a secret.)
 */
export const HOPPR_ROUTE_LABEL_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8" as const;

function keccakToUint256Decimal(hex: `0x${string}`): string {
  return BigInt(hex).toString();
}

/**
 * New on-chain route id: random UUID v4 → keccak256 → uint256 decimal string.
 * Used when an admin registers a route (no user-visible id field).
 */
export function newRouteIdDecimalFromUuid(): string {
  const id = uuidv4();
  const h = keccak256(stringToBytes(`chainpass:route:v1:${id}`));
  return keccakToUint256Decimal(h);
}

/**
 * Deterministic route id from a (category, name) pair. Used by the operator
 * admin form so a given label always produces the same on-chain uint256 id,
 * letting operators re-register the same route from a fresh DB without
 * minting a new id. UUID v5(category|name) → keccak256 → uint256 decimal.
 */
export function stableRouteIdDecimalForLabel(category: string, name: string): string {
  const key = `${category.trim()}|${name.trim()}`;
  const u = uuidv5(key, HOPPR_ROUTE_LABEL_NAMESPACE);
  const h = keccak256(stringToBytes(`chainpass:route:v1:${u}`));
  return keccakToUint256Decimal(h);
}
