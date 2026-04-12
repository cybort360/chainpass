import { useMemo } from "react"
import { useReadContract } from "wagmi"
import { chainPassTicketAbi } from "@chainpass/shared"
import { getContractAddress } from "../lib/contract"

export type TierName = "None" | "Bronze" | "Silver" | "Gold" | "Platinum"

export interface TierMeta {
  name: TierName
  color: string        // Tailwind text-* class
  bg: string           // Tailwind bg-* / gradient class for card accent
  border: string       // Tailwind border-* class
  icon: string         // emoji used for display
  min: number          // rides to reach this tier
  next: number | null  // rides to reach the next tier (null = max)
}

export const TIERS: TierMeta[] = [
  { name: "None",     color: "text-on-surface-variant", bg: "bg-surface-container-high", border: "border-outline-variant/20", icon: "○", min: 0,  next: 1  },
  { name: "Bronze",   color: "text-amber-400",           bg: "bg-amber-500/10",           border: "border-amber-500/30",       icon: "🥉", min: 1,  next: 10 },
  { name: "Silver",   color: "text-slate-300",           bg: "bg-slate-400/10",           border: "border-slate-400/30",       icon: "🥈", min: 10, next: 25 },
  { name: "Gold",     color: "text-yellow-400",          bg: "bg-yellow-500/10",          border: "border-yellow-500/30",      icon: "🥇", min: 25, next: 50 },
  { name: "Platinum", color: "text-violet-400",          bg: "bg-violet-500/10",          border: "border-violet-500/30",      icon: "💎", min: 50, next: null },
]

export function getTierMeta(tier: string): TierMeta {
  return TIERS.find((t) => t.name === tier) ?? TIERS[0]
}

export interface LoyaltyData {
  rides: number
  earned: number
  claimed: number
  available: number
  tier: TierMeta
  /** 0–100 progress within current tier band toward the next */
  progressPct: number
  /** How many rides until the next tier, or 0 if Platinum */
  ridesUntilNext: number
}

export function useLoyalty(address: `0x${string}` | undefined): {
  data: LoyaltyData | null
  isLoading: boolean
  refetch: () => void
} {
  const contractAddress = getContractAddress()

  const { data: raw, isLoading, refetch } = useReadContract({
    address: contractAddress ?? undefined,
    abi: chainPassTicketAbi,
    functionName: "loyaltyInfo",
    args: address ? [address] : undefined,
    query: {
      enabled: !!contractAddress && !!address,
      refetchInterval: 8_000,
    },
  })

  const data = useMemo<LoyaltyData | null>(() => {
    if (!raw) return null
    const [ridesBig, earnedBig, claimedBig, availableBig, tierStr] = raw as [bigint, bigint, bigint, bigint, string]
    const rides     = Number(ridesBig)
    const earned    = Number(earnedBig)
    const claimed   = Number(claimedBig)
    const available = Number(availableBig)
    const tier      = getTierMeta(tierStr)
    const ridesUntilNext = tier.next !== null ? tier.next - rides : 0
    const progressPct = tier.next !== null
      ? Math.min(100, ((rides - tier.min) / (tier.next - tier.min)) * 100)
      : 100
    return { rides, earned, claimed, available, tier, progressPct, ridesUntilNext }
  }, [raw])

  return { data, isLoading, refetch }
}
