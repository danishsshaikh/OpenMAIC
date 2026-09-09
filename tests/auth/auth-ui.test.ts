// @vitest-environment jsdom

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('next/image', () => ({
  default: ({ alt, src, className }: { alt: string; src: string; className?: string }) =>
    React.createElement('img', { alt, src, className }),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => React.createElement('a', { href, className }, children),
}));

import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';
import { SignupForm } from '@/components/auth/signup-form';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { brandConfig } from '@/lib/branding/brand-config';

const TestAuthShell = AuthShell as React.ComponentType<{
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}>;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderAuth(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(React.createElement(ThemeProvider, null, node));
  });
  return container;
}

function field(label: string): HTMLInputElement {
  const input = document.querySelector(`input[id="${label}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Missing input: ${label}`);
  return input;
}

describe('MIT ADT auth UI', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    localStorage.clear();
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    vi.restoreAllMocks();
  });

  it('renders login with configured product branding, university logos, helper text, links, and theme control', () => {
    renderAuth(
      React.createElement(
        TestAuthShell,
        {
          title: 'Sign in',
          subtitle: 'Use your MIT University faculty account.',
        },
        React.createElement(LoginForm),
      ),
    );

    expect(document.body.textContent).toContain(brandConfig.productName);
    expect(document.body.textContent).toContain(brandConfig.productDescriptor);
    expect(document.body.textContent).toContain(brandConfig.institutionFullName);
    expect(document.body.textContent).toContain('Faculty access');
    expect(document.body.textContent).toContain(`Use your @${brandConfig.approvedEmailDomain}`);
    expect(document.querySelector('img[src="/branding/sandipani-mark.svg"]')).not.toBeNull();
    expect(document.querySelector('img[src="/branding/crieya.jpeg"]')).not.toBeNull();
    expect(document.querySelector('a[href="/signup"]')?.textContent).toContain('Create one');
    expect(document.querySelector('button[aria-label="Change theme"]')).not.toBeNull();
  });

  it('renders signup with fields, password toggles, and sign-in link', () => {
    renderAuth(
      React.createElement(
        TestAuthShell,
        {
          title: 'Create account',
          subtitle: 'Use your MIT University email address.',
        },
        React.createElement(SignupForm),
      ),
    );

    expect(document.querySelector('input[autocomplete="name"]')).not.toBeNull();
    expect(document.querySelector('input[autocomplete="email"]')).not.toBeNull();
    expect(document.querySelectorAll('input[autocomplete="new-password"]')).toHaveLength(2);
    expect(document.querySelectorAll('button[aria-label^="Show"]')).toHaveLength(2);
    expect(document.querySelector('a[href="/login"]')?.textContent).toContain('Sign in');
  });

  it('uses the existing theme provider preference across auth pages', () => {
    renderAuth(
      React.createElement(
        TestAuthShell,
        {
          title: 'Sign in',
          subtitle: 'Use your MIT University faculty account.',
        },
        React.createElement(LoginForm),
      ),
    );

    act(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Change theme"]')?.click();
    });
    act(() => {
      [...document.querySelectorAll('button')]
        .find((button) => button.textContent === 'Dark')
        ?.click();
    });

    expect(localStorage.getItem('theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('keeps failed login and signup validation behavior visible', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Invalid email or password' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderAuth(
      React.createElement(
        TestAuthShell,
        {
          title: 'Sign in',
          subtitle: 'Use your MIT University faculty account.',
        },
        React.createElement(LoginForm),
      ),
    );

    act(() => {
      field('login-email').value = 'faculty@mituniversity.edu.in';
      field('login-email').dispatchEvent(new Event('input', { bubbles: true }));
      field('login-password').value = 'wrong-password';
      field('login-password').dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      document
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.any(Object));
    expect(document.body.textContent).toContain('Invalid email or password');
  });

  it('keeps university logos limited to the auth experience', () => {
    const home = readFileSync(join(process.cwd(), 'app/page.tsx'), 'utf8');
    const admin = readFileSync(join(process.cwd(), 'app/admin/users/page.tsx'), 'utf8');

    expect(home).not.toContain('/branding/mit-adt.png');
    expect(home).not.toContain('/branding/crieya.jpeg');
    expect(admin).not.toContain('/branding/mit-adt.png');
    expect(admin).not.toContain('/branding/crieya.jpeg');
  });
});
