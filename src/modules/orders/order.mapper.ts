import { LineItem, Order } from '@prisma/client';

export interface LineItemResource {
  code: string;
  unitPriceAmount: number;
  quantity: number;
  lineTotalAmount: number;
  includeFor: string[];
  percentage: string | null;
  reversal: boolean;
}

export interface OrderResource {
  id: string;
  processAlias: string;
  state: string;
  lastTransition: string | null;
  customerId: string;
  providerId: string;
  listingId: string | null;
  payinTotalAmount: number;
  payoutTotalAmount: number;
  currency: string;
  payoutReleased: boolean;
  lineItems?: LineItemResource[];
  createdAt: Date;
}

export function toLineItemResource(l: LineItem): LineItemResource {
  return {
    code: l.code,
    unitPriceAmount: Number(l.unitPriceAmount),
    quantity: l.quantity,
    lineTotalAmount: Number(l.lineTotalAmount),
    includeFor: l.includeFor,
    percentage: l.percentage === null ? null : l.percentage.toString(),
    reversal: l.reversal,
  };
}

export function toOrderResource(order: Order, lineItems?: LineItem[]): OrderResource {
  return {
    id: order.id,
    processAlias: order.processAlias,
    state: order.state,
    lastTransition: order.lastTransition,
    customerId: order.customerId,
    providerId: order.providerId,
    listingId: order.listingId,
    payinTotalAmount: Number(order.payinTotalAmount),
    payoutTotalAmount: Number(order.payoutTotalAmount),
    currency: order.currency,
    payoutReleased: order.payoutReleased,
    lineItems: lineItems?.map(toLineItemResource),
    createdAt: order.createdAt,
  };
}
