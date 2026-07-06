import fs from "node:fs";
import path from "node:path";

describe("account profile structure", () => {
  it("delegates the addresses experience to a focused account addresses section", () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/modules/account/presentation/components/AccountProfile.tsx",
      ),
      "utf8",
    );

    expect(source).toContain(
      "@/modules/account/presentation/components/AccountAddressesSection",
    );
    expect(source).toContain("<AccountAddressesSection");
  });
});
