import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useRefundOrderState } from "@/modules/orders/presentation/admin/refund-order/useRefundOrderState";

describe("useRefundOrderState", () => {
  it("initializes to a full refund and uses the remaining amount as the custom default", () => {
    const onConfirm = vi.fn();

    const { result } = renderHook(() =>
      useRefundOrderState({
        open: true,
        order: {
          id: "order-1",
          total: 125,
          refund_amount: 500,
          items: [{ id: "item-1", quantity: 1, unit_price: 125, line_total: 125 }],
        },
        onConfirm,
      }),
    );

    expect(result.current.mode).toBe("full");
    expect(result.current.remainingCents).toBe(12000);
    expect(result.current.customAmount).toBe("120.00");
    expect(result.current.refundableItems).toHaveLength(1);
  });

  it("validates product and custom refund modes before confirming", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useRefundOrderState({
        open: true,
        order: {
          id: "order-1",
          total: 125,
          refund_amount: 0,
          items: [
            { id: "item-1", quantity: 1, unit_price: 100, line_total: 100 },
            {
              id: "item-2",
              quantity: 1,
              unit_price: 25,
              line_total: 25,
              refunded_at: "2026-07-05T09:00:00.000Z",
            },
          ],
        },
        onConfirm,
      }),
    );

    act(() => {
      result.current.setMode("product");
    });

    await act(async () => {
      await result.current.handleConfirm();
    });

    expect(result.current.errorMessage).toBe("Select at least one product to refund.");

    act(() => {
      result.current.handleToggleItem("item-1");
    });

    await act(async () => {
      await result.current.handleConfirm();
    });

    expect(onConfirm).toHaveBeenLastCalledWith({
      type: "product",
      itemIds: ["item-1"],
    });

    act(() => {
      result.current.setMode("custom");
    });

    act(() => {
      result.current.setCustomAmount("0");
    });

    await act(async () => {
      await result.current.handleConfirm();
    });

    expect(result.current.errorMessage).toBe("Enter a valid refund amount.");
  });
});
