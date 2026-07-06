import { EnrollmentForm } from "@/modules/auth/presentation/components/two-factor/EnrollmentForm";
import AuthShell from "@/modules/auth/presentation/components/ui/AuthShell";

export function TwoFactorSetupPageContent() {
  return (
    <AuthShell leftVariant="login">
      <EnrollmentForm />
    </AuthShell>
  );
}
