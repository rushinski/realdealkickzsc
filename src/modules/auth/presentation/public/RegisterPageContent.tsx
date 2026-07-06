import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RegisterForm } from "@/modules/auth/presentation/components/register/RegisterForm";
import AuthShell from "@/modules/auth/presentation/components/ui/AuthShell";

export async function RegisterPageContent() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/account");
  }

  return (
    <AuthShell leftVariant="register">
      <RegisterForm />
    </AuthShell>
  );
}
