import { EmailConfirmPageContent } from "@/modules/marketing/presentation/public";

export default function EmailConfirmPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string | string[] }>;
}) {
  return <EmailConfirmPageContent searchParams={searchParams} />;
}
