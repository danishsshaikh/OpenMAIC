import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';

export default function LoginPage() {
  return (
    <AuthShell title="Sign in" subtitle="Use your MIT University faculty account.">
      <LoginForm />
    </AuthShell>
  );
}
