import { AuthShell } from '@/components/auth/auth-shell';
import { SignupForm } from '@/components/auth/signup-form';
import { brandConfig } from '@/lib/branding/brand-config';

export default function SignupPage() {
  return (
    <AuthShell
      title="Create account"
      subtitle={`Use your ${brandConfig.institutionName} email address.`}
    >
      <SignupForm />
    </AuthShell>
  );
}
