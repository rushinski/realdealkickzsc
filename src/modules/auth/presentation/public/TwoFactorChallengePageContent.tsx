import { ChallengeForm } from "@/modules/auth/presentation/components/two-factor/ChallengeForm";
import AuthShell from "@/modules/auth/presentation/components/ui/AuthShell";

export function TwoFactorChallengePageContent() {
  return (
    <AuthShell leftVariant="login">
      <ChallengeForm />
    </AuthShell>
  );
}
