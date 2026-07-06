import { redirect } from "next/navigation";

import { getServerSession } from "@/lib/auth/session";
import { getStoreAccessSettings } from "@/lib/store-access/get-store-access-settings";
import { CheckoutGate } from "@/modules/checkout/presentation/components/CheckoutGate";
import { CheckoutLockedNotice } from "@/modules/checkout/presentation/components/CheckoutLockedNotice";

export async function CheckoutGatePageContent() {
  const storeAccess = await getStoreAccessSettings();
  if (storeAccess?.settings.checkoutLockEnabled) {
    return <CheckoutLockedNotice message={storeAccess.settings.checkoutLockMessage} />;
  }

  const session = await getServerSession();
  const user = session?.user ?? null;

  if (user) {
    redirect("/checkout/start");
  }

  return <CheckoutGate />;
}
