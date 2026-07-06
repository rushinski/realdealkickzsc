import { describe, expect, it, vi } from "vitest";

import { submitProductForm } from "@/modules/catalog/presentation/admin/inventory/product-form/submitProductForm";
import type { ProductFormSubmitInput } from "@/modules/catalog/presentation/admin/inventory/productEditorTypes";

describe("submitProductForm", () => {
  it("builds the product input and submits it", async () => {
    const builtInput = { name: "Nike Air Max 1" } as ProductFormSubmitInput;
    const buildInput = vi.fn().mockReturnValue(builtInput);
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    await expect(
      submitProductForm({
        buildInput,
        onSubmit,
        logError: vi.fn(),
      }),
    ).resolves.toEqual({ toast: null });

    expect(buildInput).toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledWith(builtInput);
  });

  it("logs and returns a toast when submission fails", async () => {
    const error = new Error("Save failed");
    const logError = vi.fn();

    await expect(
      submitProductForm({
        buildInput: () => {
          throw error;
        },
        onSubmit: vi.fn(),
        logError,
      }),
    ).resolves.toEqual({
      toast: { message: "Save failed", tone: "error" },
    });

    expect(logError).toHaveBeenCalledWith(error, {
      layer: "frontend",
      event: "inventory_form_submit",
    });
  });

  it("uses a fallback toast message for unknown errors", async () => {
    await expect(
      submitProductForm({
        buildInput: () => {
          throw "bad";
        },
        onSubmit: vi.fn(),
        logError: vi.fn(),
      }),
    ).resolves.toEqual({
      toast: { message: "Failed to save product", tone: "error" },
    });
  });
});
