/** Every user-visible string the Orders (checkout + order lifecycle) module can put on the wire. */
export const OrderResponseMessage = {
  success: {
    PRICE_SPECULATED: 'Price breakdown calculated successfully.',
    CHECKOUT_STARTED: 'Checkout started successfully.',
    PAYMENT_CONFIRMED: 'Payment confirmed successfully.',
    ORDER_FETCHED: 'Order fetched successfully.',
    ORDERS_FETCHED: 'Orders fetched successfully.',
    TRANSITION_APPLIED: 'Order updated successfully.',
  },

  fail: {
    ORDER_NOT_FOUND: 'Order not found.',
    NOT_ORDER_PARTY: 'You are not a party to this order.',
    NOT_YOUR_ORDER: 'This order does not belong to you.',
    CANNOT_BUY_OWN_LISTING: 'You cannot buy your own listing.',
    INVALID_QUANTITY: 'Quantity must be a positive whole number.',
    INVALID_TRANSITION: 'This order cannot make that transition from its current state.',
    PAYMENT_FAILED: 'Payment could not be completed. Please try another payment method.',
    LISTING_UNAVAILABLE: 'This listing is no longer available for purchase.',
  },
} as const;
