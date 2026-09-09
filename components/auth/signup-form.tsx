'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Eye, EyeOff, Loader2, UserPlus } from 'lucide-react';
import { setBrowserAuthUserId } from '@/lib/auth/client-storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { brandConfig } from '@/lib/branding/brand-config';

export function SignupForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, confirmPassword }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        user?: { id: string };
      };
      if (!response.ok || !data.user) {
        setError(data.error || 'Signup failed');
        return;
      }
      setBrowserAuthUserId(data.user.id);
      window.location.assign('/');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <Field>
        <FieldLabel htmlFor="signup-name">Name</FieldLabel>
        <Input
          id="signup-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          type="text"
          autoComplete="name"
          required
          className="h-11 bg-background/70 px-3 focus-visible:ring-primary/20"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="signup-email">University Email</FieldLabel>
        <Input
          id="signup-email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          autoComplete="email"
          required
          className="h-11 bg-background/70 px-3 focus-visible:ring-primary/20"
        />
        <FieldDescription>
          Use your @{brandConfig.approvedEmailDomain} email address.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="signup-password">Password</FieldLabel>
        <InputGroup>
          <InputGroupInput
            id="signup-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type={passwordVisible ? 'text' : 'password'}
            autoComplete="new-password"
            required
            className="h-11 bg-background/70 px-3 focus-visible:ring-primary/20"
          />
          <InputGroupButton
            type="button"
            size="icon-xs"
            aria-label={passwordVisible ? 'Hide password' : 'Show password'}
            onClick={() => setPasswordVisible((value) => !value)}
          >
            {passwordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </InputGroupButton>
        </InputGroup>
      </Field>
      <Field>
        <FieldLabel htmlFor="signup-confirm-password">Confirm Password</FieldLabel>
        <InputGroup>
          <InputGroupInput
            id="signup-confirm-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            type={confirmPasswordVisible ? 'text' : 'password'}
            autoComplete="new-password"
            required
            className="h-11 bg-background/70 px-3 focus-visible:ring-primary/20"
          />
          <InputGroupButton
            type="button"
            size="icon-xs"
            aria-label={confirmPasswordVisible ? 'Hide confirm password' : 'Show confirm password'}
            onClick={() => setConfirmPasswordVisible((value) => !value)}
          >
            {confirmPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </InputGroupButton>
        </InputGroup>
      </Field>
      {error && <FieldError>{error}</FieldError>}
      <Button
        type="submit"
        disabled={submitting}
        size="lg"
        className="mt-2 h-11 w-full bg-[linear-gradient(90deg,var(--brand-primary),var(--brand-secondary))] shadow-[0_16px_32px_-20px_rgb(var(--brand-shadow))] hover:opacity-95"
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <UserPlus className="h-4 w-4" />
        )}
        Create account
      </Button>
      <p className="pt-1 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link
          href="/login"
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
