import { getAddress } from "viem"

const raw = import.meta.env

/** Validate format then normalise to EIP-55 checksum so viem/wagmi never rejects it. */
function optionalAddress(value: string | undefined): `0x${string}` | undefined {
  if (!value || !/^0x[a-fA-F0-9]{40}$/i.test(value)) return undefined
  try { return getAddress(value) } catch { return undefined }
}

/**
 * Parse VITE_GATE_WALLETS — comma-separated wallet addresses allowed to see the Gate tab.
 * If unset or empty, the tab is visible to everyone.
 */
function parseGateWallets(value: string | undefined): Set<string> {
  if (!value) return new Set()
  return new Set(
    value.split(",")
      .map((s) => s.trim())
      .filter((s) => /^0x[a-fA-F0-9]{40}$/i.test(s))
      .map((s) => s.toLowerCase()),
  )
}

function parseOperatorWallets(value: string | undefined): Set<string> {
  if (!value) return new Set()
  return new Set(
    value.split(",")
      .map((s) => s.trim())
      .filter((s) => /^0x[a-fA-F0-9]{40}$/i.test(s))
      .map((s) => s.toLowerCase()),
  )
}

/** Parse a bigint-safe integer env var. Returns undefined for empty / invalid. */
function parseBigintEnv(value: string | undefined): bigint | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  try { return BigInt(trimmed) } catch { return undefined }
}

export const env = {
  apiUrl: (raw.VITE_CHAINPASS_API_URL as string | undefined) ?? "http://localhost:3001",
  contractAddress: optionalAddress(raw.VITE_CHAINPASS_CONTRACT_ADDRESS as string | undefined),
  privyAppId: (raw.VITE_PRIVY_APP_ID as string | undefined) ?? "",
  privyClientId: (raw.VITE_PRIVY_CLIENT_ID as string | undefined) ?? "",
  /** Operator address stored on tickets at mint (demo default). */
  defaultOperator: optionalAddress(raw.VITE_DEFAULT_OPERATOR_ADDRESS as string | undefined) ?? "0x0000000000000000000000000000000000000000",
  /**
   * USDC contract on Monad testnet: 0x534b2f3A21130d7a60830c2Df862319e593943A3
   * Set VITE_USDC_CONTRACT_ADDRESS in client/.env to enable USDC payments.
   */
  usdcAddress: optionalAddress(raw.VITE_USDC_CONTRACT_ADDRESS as string | undefined),
  /**
   * Comma-separated wallet addresses that may see the Gate tab.
   * If empty / unset, the Gate tab is visible to everyone.
   * Example: VITE_GATE_WALLETS=0xAbc…,0xDef…
   */
  gateWallets: parseGateWallets(raw.VITE_GATE_WALLETS as string | undefined),
  /**
   * Comma-separated wallet addresses that may see the Operations tab.
   * If empty / unset, the Ops tab is visible to everyone.
   * Example: VITE_OPERATOR_WALLETS=0xAbc…
   */
  operatorWallets: parseOperatorWallets(raw.VITE_OPERATOR_WALLETS as string | undefined),
  /**
   * Block number the current ticket contract was deployed at. Used as the lower
   * bound for on-chain getLogs scans so we don't hammer the RPC with 0→latest
   * scans that trigger HTTP 413 "Content Too Large" on Monad's public endpoint.
   * Falls back to 0n if unset — chunked helpers still protect against 413s but
   * scanning the full chain is slow; prefer setting this in prod.
   */
  contractDeployBlock: parseBigintEnv(raw.VITE_CONTRACT_DEPLOY_BLOCK as string | undefined) ?? 0n,
}
