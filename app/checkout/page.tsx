// app/checkout/page.tsx
import { CheckoutGatePageContent } from "@/modules/checkout/presentation/CheckoutGatePageContent";

export const dynamic = "force-dynamic";

export default function CheckoutGatePage() {
  return <CheckoutGatePageContent />;
}
