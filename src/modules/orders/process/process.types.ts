import { OrderProcess } from '@prisma/client';

export type Actor = 'customer' | 'provider' | 'operator' | 'system';

/** A side-effect a transition triggers (money movement). Mapped to gateway calls by the executor. */
export type TransitionAction =
  | 'create-payment-intent'
  | 'confirm-capture'
  | 'cancel-payment-intent'
  | 'payout'
  | 'refund-full';

export interface TransitionDef {
  name: string;
  from: string[]; // allowed current states (assert order.state ∈ from else 409)
  to: string;
  actor: Actor[]; // who may invoke (assert else 403)
  privileged?: boolean; // recompute line items server-side on this transition
  action?: TransitionAction;
}

/** Timer anchored to ENTERING a state: schedules `transition` at now()+after (ISO-8601 duration). */
export interface StateTimer {
  after: string; // ISO-8601 duration, e.g. "PT15M", "P3D", "P14D"
  transition: string;
}

export interface ProcessDefinition {
  alias: string;
  name: OrderProcess;
  initial: string;
  states: string[];
  transitions: TransitionDef[];
  /** Per-state entry timers (replaces Sharetribe EDN time-based transitions). */
  stateTimers?: Record<string, StateTimer>;
  /** States that immediately auto-advance on entry (e.g. received → completed). */
  immediateNext?: Record<string, string>;
}

/** Minimal ISO-8601 duration → milliseconds (supports the P#DT#H#M#S subset our processes use). */
export function durationToMs(iso: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m) throw new Error(`Unsupported ISO-8601 duration: ${iso}`);
  const [, d, h, min, s] = m;
  return (
    (Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0)) * 1000
  );
}
