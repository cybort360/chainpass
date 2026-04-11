/** True when the user dismissed or rejected the wallet prompt (not a chain/revert failure). */
export function isUserRejectedWalletError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false
  const walk = (e: unknown, depth: number): boolean => {
    if (depth > 6 || e == null || typeof e !== "object") return false
    const o = e as Record<string, unknown>
    if (o.name === "UserRejectedRequestError") return true
    if (o.code === 4001) return true
    const msg = typeof o.message === "string" ? o.message : ""
    if (/user rejected|user denied|rejected the request|denied transaction signature/i.test(msg)) {
      return true
    }
    return walk(o.cause, depth + 1)
  }
  return walk(error, 0)
}

/**
 * Short, human-readable copy for writeContract errors. Avoids dumping full viem traces in the UI.
 */
export function formatWriteContractError(error: unknown): string {
  if (isUserRejectedWalletError(error)) {
    return "You cancelled the transaction in your wallet."
  }
  if (error != null && typeof error === "object") {
    const o = error as { shortMessage?: string; message?: string }
    if (typeof o.shortMessage === "string" && o.shortMessage.length > 0 && o.shortMessage.length < 280) {
      return o.shortMessage
    }
    if (typeof o.message === "string") {
      const first = o.message.split("\n")[0]?.trim()
      if (first && first.length < 220) return first
    }
  }
  return "Transaction failed. Please try again."
}
