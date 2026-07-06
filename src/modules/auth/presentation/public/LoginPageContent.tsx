import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LoginForm } from "@/modules/auth/presentation/components/login/LoginFormRouter";
import AuthShell from "@/modules/auth/presentation/components/ui/AuthShell";

export async function LoginPageContent() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/account");
  }

  return (
    <AuthShell>
      <LoginForm />
    </AuthShell>
  );
}
