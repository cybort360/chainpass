/**
 * Chunked `eth_getLogs` helper.
 *
 * Why this exists: public Monad testnet RPC (testnet-rpc.monad.xyz) rejects
 * wide scans with HTTP 413 "Content Too Large". Any direct call that does
 * `fromBlock: 0n, toBlock: "latest"` on a chain with millions of blocks will
 * fail. Callers pass a factory closing over their static `getLogs` params
 * (address, event, args) and we vary the block range across chunks.
 *
 * Chunks run with bounded concurrency so total wall-clock time stays reasonable
 * even when the configured range is large. Failing chunks are swallowed —
 * callers can degrade gracefully (e.g. fall back to indexer / API) without
 * losing results from chunks that did succeed.
 */

/**
 * Default chunk size. Monad testnet's public RPC returns HTTP 413 "Content Too
 * Large" when the *response* body is too big — not when the block range itself
 * is too wide. 1k blocks keeps individual responses small enough that events
 * from a busy contract still fit.
 */
const DEFAULT_CHUNK_SIZE = 1_000n

/**
 * Concurrency kept at 1 (serial) against Monad's public RPC. Callers often run
 * two scans (burn + mint) in parallel already, so effective concurrency is 2.
 * Higher values trip rate-limit (429) and content-size (413) guards.
 */
const DEFAULT_CONCURRENCY = 1

export async function fetchLogsChunked<T>(
  fetchRange: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
  fromBlock: bigint,
  toBlock: bigint,
  options: { chunkSize?: bigint; concurrency?: number } = {},
): Promise<T[]> {
  if (fromBlock > toBlock) return []

  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY

  // Build the full list of (from, to) chunk boundaries up front so workers
  // can pick them off a shared index without having to coordinate.
  const chunks: Array<{ from: bigint; to: bigint }> = []
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = start + chunkSize - 1n > toBlock ? toBlock : start + chunkSize - 1n
    chunks.push({ from: start, to: end })
  }

  const results: T[][] = new Array(chunks.length)
  let nextIndex = 0
  async function worker(): Promise<void> {
    while (nextIndex < chunks.length) {
      const i = nextIndex++
      const { from, to } = chunks[i]
      try {
        results[i] = await fetchRange(from, to)
      } catch {
        // Silently drop this chunk — caller decides how to handle partial data.
        results[i] = []
      }
    }
  }

  const workerCount = Math.min(concurrency, chunks.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  return results.flat()
}
