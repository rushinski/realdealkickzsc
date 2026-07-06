"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import type { OrderStatusResponse } from "@/types/domain/checkout";
import { OrderStatusView } from "@/modules/orders/presentation/public/order-status/components/OrderStatusView";

function OrderStatusLoadingState() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-20 text-center">
      <Loader2 className="mx-auto h-16 w-16 animate-spin text-brand-text" />
    </div>
  );
}

function OrderStatusContent() {
  const router = useRouter();
  const params = useParams<{ orderId: string }>();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const orderId = params?.orderId;

  const [status, setStatus] = useState<OrderStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) {
      return;
    }
    if (!token) {
      setError("Missing secure order link. Please check your email.");
      return;
    }

    const loadStatus = async () => {
      try {
        const response = await fetch(
          `/api/orders/${orderId}?token=${encodeURIComponent(token)}`,
          { cache: "no-store" },
        );
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.error || "Unable to load order status.");
        }
        setStatus(data);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unable to load order status.";
        setError(message);
      }
    };

    void loadStatus();
  }, [orderId, token]);

  if (!orderId) {
    return null;
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <div className="border border-brand-border bg-brand-surface p-6">
          <p className="mb-2 text-lg font-semibold uppercase tracking-[0.08em] text-brand-text">
            Order status unavailable
          </p>
          <p>{error}</p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="mt-4 border border-brand-text bg-brand-text px-6 py-2 text-sm font-semibold uppercase tracking-[0.08em] text-brand-surface transition-colors hover:bg-neutral-800"
          >
            Back to home
          </button>
        </div>
      </div>
    );
  }

  if (!status) {
    return <OrderStatusLoadingState />;
  }

  return <OrderStatusView status={status} />;
}

export function OrderStatusPageContent() {
  return (
    <Suspense fallback={<OrderStatusLoadingState />}>
      <OrderStatusContent />
    </Suspense>
  );
}
