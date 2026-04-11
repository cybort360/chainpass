import { getAddress } from "viem"
import { env } from "./env"

export function getContractAddress(): `0x${string}` | undefined {
  const a = env.contractAddress
  if (!a) return undefined
  try {
    return getAddress(a)
  } catch {
    return undefined
  }
}
