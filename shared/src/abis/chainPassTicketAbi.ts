import type { Abi } from "viem";
import artifact from "./chainPassTicket.json" with { type: "json" };

export const chainPassTicketAbi = artifact.abi as Abi;
