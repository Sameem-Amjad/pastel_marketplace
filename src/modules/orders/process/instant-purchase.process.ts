import { ProcessDefinition } from './process.types';

/**
 * instant-purchase / release-14 — the PRIMARY transaction process (doc 04 §1).
 *
 * Escrow model: funds are captured to the PLATFORM balance at confirm-payment and only transferred to
 * the seller at mark-received (or the P14D auto-mark-received timer). Payout is the irreversibility
 * boundary. Timers are taken verbatim from the EDN (doc 04 §1.2): PT15M / P3D / P14D / P7D.
 *
 * This is a faithful CORE of the ~70-transition EDN — the happy path plus expiry, auto-cancel, and the
 * dispute entry. The full dispute/replacement/partial-refund sub-graph is seeded the same way (data, not
 * code) and is tracked for Phase 3 completion.
 */
export const INSTANT_PURCHASE: ProcessDefinition = {
  alias: 'instant-purchase/release-14',
  name: 'instant_purchase',
  initial: 'initial',
  states: [
    'initial',
    'pending-payment',
    'payment-expired',
    'purchased',
    'pending-shipment',
    'shipped',
    'delivered',
    'received',
    'completed',
    'reviewed',
    'canceled',
    'disputed',
    'escalated-dispute',
  ],
  transitions: [
    { name: 'request-payment', from: ['initial'], to: 'pending-payment', actor: ['customer'], privileged: true, action: 'create-payment-intent' },
    { name: 'confirm-payment', from: ['pending-payment'], to: 'purchased', actor: ['customer'], privileged: true, action: 'confirm-capture' },
    { name: 'expire-payment', from: ['pending-payment'], to: 'payment-expired', actor: ['system'], action: 'cancel-payment-intent' },

    { name: 'confirm-order', from: ['purchased'], to: 'pending-shipment', actor: ['provider', 'operator'] },
    { name: 'mark-shipped', from: ['pending-shipment'], to: 'shipped', actor: ['provider', 'operator'] },
    { name: 'mark-delivered', from: ['shipped'], to: 'delivered', actor: ['provider', 'system', 'operator'] },

    { name: 'mark-received', from: ['delivered'], to: 'received', actor: ['customer'], action: 'payout' },
    { name: 'auto-mark-received', from: ['delivered'], to: 'received', actor: ['system'], action: 'payout' },
    // synthetic immediate advance (received → completed), invoked only by the executor's immediateNext
    { name: 'mark-completed', from: ['received'], to: 'completed', actor: ['system'] },

    { name: 'auto-cancel', from: ['purchased'], to: 'canceled', actor: ['system'], action: 'refund-full' },

    { name: 'dispute', from: ['pending-shipment', 'shipped', 'delivered'], to: 'disputed', actor: ['customer'] },
    { name: 'approve-refund', from: ['disputed', 'escalated-dispute'], to: 'canceled', actor: ['provider', 'operator'], action: 'refund-full' },
    { name: 'decline-dispute', from: ['disputed'], to: 'escalated-dispute', actor: ['provider'] },
    { name: 'auto-escalate-dispute', from: ['disputed'], to: 'escalated-dispute', actor: ['system'] },
    { name: 'resolve-release', from: ['escalated-dispute'], to: 'received', actor: ['operator'], action: 'payout' },

    { name: 'expire-review-period', from: ['completed'], to: 'reviewed', actor: ['system'] },
  ],
  stateTimers: {
    'pending-payment': { after: 'PT15M', transition: 'expire-payment' },
    purchased: { after: 'P3D', transition: 'auto-cancel' },
    delivered: { after: 'P14D', transition: 'auto-mark-received' },
    disputed: { after: 'P3D', transition: 'auto-escalate-dispute' },
    completed: { after: 'P7D', transition: 'expire-review-period' },
  },
  // received → completed is immediate once the payout has fired (doc 04 §1.1).
  immediateNext: { received: 'mark-completed' },
};
