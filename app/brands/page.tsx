import { BrandsPageContent } from "@/modules/storefront";

export const revalidate = 300;

export default function BrandsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  return <BrandsPageContent searchParams={searchParams} />;
}
