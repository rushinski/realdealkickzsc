"use client";

import type { OrderStatusResponse } from "@/types/domain/checkout";

const formatEventType = (type: string) =>
  type.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

const formatDate = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function OrderStatusView({ status }: { status: OrderStatusResponse }) {
  const instructions = status.pickupInstructions
    ? status.pickupInstructions.split("\n").filter(Boolean)
    : [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.35em] text-brand-muted">Orders</p>
        <h1 className="mb-2 mt-3 text-3xl font-black uppercase tracking-[0.08em] text-brand-text">
          Order status
        </h1>
        <p className="text-brand-muted">Order ID: {status.id}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div className="border border-brand-border bg-brand-surface p-6">
            <h2 className="mb-4 text-xl font-semibold uppercase tracking-[0.08em] text-brand-text">
              Status
            </h2>
            <div className="flex items-center justify-between text-brand-muted">
              <span>Current</span>
              <span className="font-semibold capitalize text-brand-text">
                {status.status}
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {status.events.length === 0 ? (
                <p className="text-sm text-brand-muted">
                  Timeline updates will appear here.
                </p>
              ) : (
                status.events.map((event) => (
                  <div
                    key={`${event.type}-${event.createdAt}`}
                    className="border border-brand-border bg-brand-page p-4"
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-sm font-semibold text-brand-text">
                        {formatEventType(event.type)}
                      </span>
                      <span className="text-xs text-brand-muted">
                        {formatDate(event.createdAt)}
                      </span>
                    </div>
                    {event.message && (
                      <p className="text-sm text-brand-muted">{event.message}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {status.fulfillment === "pickup" && instructions.length > 0 && (
            <div className="border border-brand-border bg-brand-surface p-6">
              <h2 className="mb-3 text-xl font-semibold uppercase tracking-[0.08em] text-brand-text">
                Pickup instructions
              </h2>
              <ul className="space-y-2 text-sm text-brand-muted">
                {instructions.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="border border-brand-border bg-brand-surface p-6">
            <h2 className="mb-3 text-xl font-semibold uppercase tracking-[0.08em] text-brand-text">
              Need help?
            </h2>
            <p className="mb-3 text-sm text-brand-muted">
              Email us at{" "}
              <a
                className="font-semibold text-brand-text underline-offset-4 hover:underline"
                href={`mailto:${status.supportEmail}`}
              >
                {status.supportEmail}
              </a>{" "}
              for order questions or scheduling pickup.
            </p>
            <p className="text-xs text-brand-muted">
              If you no longer have your order email, contact{" "}
              <a
                href="mailto:null@gmail.com"
                className="font-semibold text-brand-text underline-offset-4 hover:underline"
              >
                null@gmail.com
              </a>
              .
            </p>
          </div>
        </div>

        <div className="h-fit border border-brand-border bg-brand-surface p-6">
          <h2 className="mb-4 text-lg font-semibold uppercase tracking-[0.08em] text-brand-text">
            Order summary
          </h2>
          <div className="space-y-2 text-sm text-brand-muted">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>${status.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Shipping</span>
              <span>
                {status.fulfillment === "pickup"
                  ? "Free (Pickup)"
                  : `$${status.shipping.toFixed(2)}`}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Tax</span>
              <span>${status.tax.toFixed(2)}</span>
            </div>
            <div className="mt-2 border-t border-brand-border pt-2">
              <div className="flex justify-between font-semibold text-brand-text">
                <span>Total</span>
                <span>${status.total.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
