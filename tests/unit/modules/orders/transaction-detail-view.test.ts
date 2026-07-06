import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/checkout/display-pricing", () => ({
  calculateCheckoutDisplayTotals: vi.fn(() => ({
    processingFee: 10,
    displayTotal: 135,
  })),
}));

vi.mock("@/lib/orders/metrics", () => ({
  shouldShowOrderProfit: vi.fn(() => true),
}));

vi.mock("@/modules/orders/presentation/admin/transaction-detail/transactionEmailView", () => ({
  getEmailTypeMeta: vi.fn(() => ({ label: "Email", tone: "default" })),
  getRelatedCheckoutLogs: vi.fn(() => []),
}));

vi.mock("@/modules/orders/presentation/admin/transaction-detail/transactionPaymentView", () => ({
  fmtDate: vi.fn((value: string) => value),
  getAvsLabel: vi.fn(() => "AVS"),
  getCvvLabel: vi.fn(() => "CVV"),
  getEventMeta: vi.fn(() => ({ label: "Event", tone: "default" })),
  getRiskBadge: vi.fn(() => ({ label: "Low", tone: "success" })),
  getOrderStatusMeta: vi.fn(() => ({ label: "Paid", tone: "success" })),
}));

import { buildTransactionDetailViewModel } from "@/modules/orders/presentation/admin/transaction-detail/transactionDetailView";

describe("buildTransactionDetailViewModel", () => {
  it("builds pricing, refund, and checklist state from the order payload", () => {
    const result = buildTransactionDetailViewModel({
      emailLogs: [
        {
          id: "email-1",
          email_type: "order_confirmation",
          recipient_email: "buyer@example.com",
          sent_at: "2026-07-05T10:00:00.000Z",
          delivery_status: "sent",
        },
      ],
      order: {
        id: "order-1",
        status: "paid",
        fulfillment: "ship",
        subtotal: 100,
        shipping: 20,
        tax_amount: 5,
        total: 125,
        refund_amount: 500,
        guest_email: "guest@example.com",
        profiles: { email: "buyer@example.com", full_name: "Buyer One" },
        shipping_address: {
          name: "Buyer One",
          phone: "555-0100",
        },
        items: [
          {
            id: "item-1",
            quantity: 1,
            unit_price: 100,
            line_total: 100,
          },
          {
            id: "item-2",
            quantity: 1,
            unit_price: 25,
            line_total: 25,
            refunded_at: "2026-07-05T09:00:00.000Z",
          },
        ],
      },
      paymentEvents: [
        {
          id: "payment-1",
          event_type: "authorized",
          event_data: {},
          created_at: "2026-07-05T11:00:00.000Z",
        },
      ],
      paymentTx: {
        id: "txn-1",
        customer_email: "tx@example.com",
        billing_name: "Billing Name",
      },
      selectedPaymentEventId: "payment-1",
      items: [
        {
          id: "item-1",
          quantity: 1,
          unit_price: 100,
          line_total: 100,
        },
        {
          id: "item-2",
          quantity: 1,
          unit_price: 25,
          line_total: 25,
          refunded_at: "2026-07-05T09:00:00.000Z",
        },
      ],
      getOrderItemFinancials: (item) => ({
        quantity: item.quantity ?? 0,
        unitCost: item.id === "item-1" ? 60 : 15,
        unitPrice: item.unit_price ?? 0,
        unitProfit: item.id === "item-1" ? 40 : 10,
      }),
    });

    expect(result.displayTotal).toBe(135);
    expect(result.processingFee).toBe(10);
    expect(result.refundedCents).toBe(500);
    expect(result.refundedAmount).toBe(5);
    expect(result.customerEmail).toBe("buyer@example.com");
    expect(result.customerName).toBe("Buyer One");
    expect(result.customerPhone).toBe("555-0100");
    expect(result.isRefundable).toBe(true);
    expect(result.checklistTypes).toEqual([
      "order_confirmation",
      "label_created",
      "in_transit",
      "delivered",
      "refund_notification",
    ]);
    expect(result.selectedPaymentEvent?.id).toBe("payment-1");
    expect(result.sessionTimeline.map((entry) => entry.id)).toEqual([
      "payment-payment-1",
      "email-email-1",
    ]);
  });
});
