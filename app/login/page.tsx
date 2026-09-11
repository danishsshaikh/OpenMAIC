import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';
import { brandConfig } from '@/lib/branding/brand-config';

export default function LoginPage() {
  return (
    <AuthShell
      title="Sign in"
      subtitle={`Use your ${brandConfig.institutionName} faculty account.`}
    >
      <LoginForm />
    </AuthShell>
  );
}
