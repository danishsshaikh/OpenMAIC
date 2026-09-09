import { AuthShell } from '@/components/auth/auth-shell';
import { SignupForm } from '@/components/auth/signup-form';

export default function SignupPage() {
  return (
    <AuthShell title="Create account" subtitle="Use your MIT University email address.">
      <SignupForm />
    </AuthShell>
  );
}
