// app/admin/layout.tsx
import { AdminLayoutShell } from "@/modules/app-shell/presentation/AdminLayoutShell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminLayoutShell>{children}</AdminLayoutShell>;
}
