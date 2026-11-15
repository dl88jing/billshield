import type { Finding } from "./audit";
import { totalAtStake } from "./audit";

/** The only fields BillShield ever writes to Firestore. Must match the hasOnly() list in firestore.rules (minus server-set `v` and `at`). */
export const AGGREGATE_FIELDS = ["rules", "stakeBucket", "deviceSource", "letterSource", "gatePass"] as const;

export type AggregateStat<S extends string = string> = { rules: Record<string, number>; stakeBucket: string; deviceSource: S; letterSource: S; gatePass: boolean };

/** Coarse dollar bucket, so no exact amount from the bill is stored. */
export function stakeBucket(total: number): string {
  return total === 0 ? "0" : total < 250 ? "<250" : total < 1000 ? "250-1k" : ">=1k";
}

/** Build the anonymous aggregate record: per-rule counts + a dollar bucket + inference sources. No bill text, no identifiers. */
export function buildAggregate<S extends string>(findings: Finding[], deviceSource: S, letterSource: S, gatePass = true): AggregateStat<S> {
  const rules: Record<string, number> = {};
  findings.forEach((x) => { rules[x.rule] = (rules[x.rule] ?? 0) + 1; });
  return { rules, stakeBucket: stakeBucket(totalAtStake(findings)), deviceSource, letterSource, gatePass };
}
