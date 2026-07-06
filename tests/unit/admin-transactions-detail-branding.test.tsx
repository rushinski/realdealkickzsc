import { vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import TransactionDetailPage from "../../app/admin/transactions/[orderId]/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ orderId: "order-123" }),
  useRouter: () => ({ push: vi.fn() }),
}));

describe("admin transactions detail branding", () => {
  it("renders the loading state on shared admin surfaces", () => {
    const html = renderToStaticMarkup(<TransactionDetailPage />);

    expect(html).toContain("Loading...");
    expect(html).toContain("brand-surface");
    expect(html).not.toContain("text-gray-400");
  });
});
