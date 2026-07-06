import { renderToStaticMarkup } from "react-dom/server";

import AuthShell from "@/modules/auth/presentation/components/ui/AuthShell";

describe("AuthShell", () => {
  it("renders solesneakers branding", () => {
    const html = renderToStaticMarkup(
      <AuthShell>
        <div>form</div>
      </AuthShell>,
    );

    expect(html).toContain("solesneakers");
  });
});
