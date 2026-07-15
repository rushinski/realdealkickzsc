import { BrandsPageContent } from "@/modules/storefront/presentation/brands/BrandsPageContent";

export const revalidate = 300;

export default function BrandsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  return <BrandsPageContent searchParams={searchParams} />;
}
