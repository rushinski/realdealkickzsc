import fs from "node:fs";
import path from "node:path";

describe("runtime cleanup", () => {
  it("does not mount vercel analytics providers in the root layout shell", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/modules/app-shell/presentation/RootLayoutShell.tsx"),
      "utf8",
    );

    expect(source).not.toContain("@vercel/analytics/next");
    expect(source).not.toContain("@vercel/speed-insights/next");
    expect(source).not.toContain("<Analytics />");
    expect(source).not.toContain("<SpeedInsights />");
  });
});
