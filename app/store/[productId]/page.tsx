// app/store/[productId]/page.tsx
import type { Metadata } from "next";

import { buildStoreProductMetadata } from "@/modules/storefront/application/storefront-product";
import { StoreProductDetailPageContent } from "@/modules/storefront/presentation/product/StoreProductDetailPageContent";

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ productId: string }>;
}): Promise<Metadata> {
  const { productId } = await params;
  return buildStoreProductMetadata(productId);
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  return <StoreProductDetailPageContent productId={productId} />;
}
