import { MaterialIcon } from "./MaterialIcon"
import { MotionSection } from "./MotionSection"

const pillars = [
  {
    icon: "directions_run",
    title: "Throughput for real gates",
    body:
      "Monad targets very high throughput so busy routes can clear passengers without queues backing up at validation — the kind of load transit actually sees.",
  },
  {
    icon: "timer",
    title: "Fast blocks & finality",
    body:
      "~400ms block time and ~800ms finality mean mint and burn settle quickly. Scan → verify → burn feels responsive for conductors and riders.",
  },
  {
    icon: "code",
    title: "EVM-native stack",
    body:
      "Solidity, Foundry, wagmi, viem, and standard wallets — no exotic VM. Hoppr uses familiar ERC-721 patterns and tooling you already ship with.",
  },
  {
    icon: "payments",
    title: "Small fares, real-world cost",
    body:
      "Gas is priced in MON; low token price keeps typical actions like transfers and swaps cheap in dollar terms — important for low ticket prices.",
  },
  {
    icon: "sync",
    title: "Tighter UI feedback",
    body:
      "Where the network exposes eth_sendRawTransactionSync-style RPCs, purchase and burn can return receipts in one round-trip — snappier UX for kiosks and phones.",
  },
  {
    icon: "hub",
    title: "Growing ecosystem",
    body:
      "Major infra and tooling providers support Monad mainnet and testnet — easier RPC, indexing, and integrations as you harden production.",
  },
] as const

export function WhyMonadSection() {
  return (
    <MotionSection
      id="why-monad"
      className="scroll-mt-28 px-8 py-24 bg-gradient-to-b from-surface-container-low/80 via-surface to-surface"
    >
      <div className="mx-auto max-w-7xl">
        <div className="mb-14 flex flex-col items-center text-center">
          <div className="mb-4 flex items-center gap-3">
            <span className="rounded-full bg-primary/15 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
              Built on Monad
            </span>
            <img
              src="/monad/full-logo-white.svg"
              alt=""
              className="hidden h-5 w-auto opacity-90 sm:block sm:h-6"
              width={120}
              height={24}
            />
          </div>
          <h2 className="font-headline text-4xl font-bold tracking-tight text-white sm:text-5xl">Why Monad</h2>
          <p className="mt-4 max-w-2xl text-lg text-on-surface-variant">
            Hoppr is built for gate-like validation: many passengers with fresh QR codes and conductors confirming tickets on-chain without long waits.
            That pattern fits a chain built for throughput, low fees on small-value transactions, and fast finality — with full EVM compatibility so we ship
            standard NFT and wallet flows.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {pillars.map((p) => (
            <article
              key={p.title}
              className="group rounded-2xl bg-surface-container p-6 outline outline-1 outline-outline-variant/15 transition-colors hover:bg-surface-container-high"
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary transition-colors group-hover:bg-primary/25">
                <MaterialIcon name={p.icon} className="text-2xl" />
              </div>
              <h3 className="font-headline text-lg font-bold text-white">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">{p.body}</p>
            </article>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a
            className="font-headline text-sm font-semibold text-primary underline-offset-4 transition-colors hover:text-primary-container hover:underline"
            href="https://docs.monad.xyz/"
            rel="noopener noreferrer"
            target="_blank"
          >
            Monad documentation
          </a>
          <span className="hidden text-on-surface-variant sm:inline" aria-hidden>
            ·
          </span>
          <a
            className="font-headline text-sm font-semibold text-primary underline-offset-4 transition-colors hover:text-primary-container hover:underline"
            href="https://docs.monad.xyz/tooling-and-infra/"
            rel="noopener noreferrer"
            target="_blank"
          >
            Tooling &amp; infrastructure
          </a>
        </div>
      </div>
    </MotionSection>
  )
}
