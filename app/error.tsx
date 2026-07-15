"use client";

import { SystemErrorPageContent } from "@/modules/app-shell/presentation/SystemErrorPageContent";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SystemErrorPageContent error={error} reset={reset} />;
}
