import { InventoryPageContent } from "@/modules/catalog/presentation/admin/inventory";

interface InventoryPageProps {
  searchParams: Promise<{
    q?: string;
    category?: string;
    condition?: string;
    stockStatus?: string;
    page?: string;
  }>;
}

export default function InventoryPage({ searchParams }: InventoryPageProps) {
  return <InventoryPageContent searchParams={searchParams} />;
}
