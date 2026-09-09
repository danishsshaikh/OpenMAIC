'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Eye, EyeOff, Loader2, LogIn } from 'lucide-react';
import { setBrowserAuthUserId } from '@/lib/auth/client-storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { brandConfig } from '@/lib/branding/brand-config';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        user?: { id: string };
      };
      if (!response.ok || !data.user) {
        setError(data.error || 'Invalid email or password');
        return;
      }
      setBrowserAuthUserId(data.user.id);
      window.location.assign('/');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      <Field>
        <FieldLabel htmlFor="login-email">University Email</FieldLabel>
        <Input
          id="login-email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          autoComplete="email"
          required
        />
        <FieldDescription>
          Use your @{brandConfig.approvedEmailDomain} email address.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="login-password">Password</FieldLabel>
        <InputGroup>
          <InputGroupInput
            id="login-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type={passwordVisible ? 'text' : 'password'}
            autoComplete="current-password"
            required
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
      {error && <FieldError>{error}</FieldError>}
      <Button type="submit" disabled={submitting} size="lg" className="w-full">
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
        Sign in
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        New to {brandConfig.shortName}?{' '}
        <Link
          href="/signup"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Create one
        </Link>
      </p>
    </form>
  );
}
