// app/layout.tsx
import {
  RootLayoutShell,
  rootLayoutMetadata,
  rootLayoutViewport,
} from "@/modules/app-shell/presentation";

export const metadata = rootLayoutMetadata;
export const viewport = rootLayoutViewport;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <RootLayoutShell>{children}</RootLayoutShell>;
}
