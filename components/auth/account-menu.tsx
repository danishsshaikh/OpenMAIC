'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LogOut, Shield, User } from 'lucide-react';
import { clearBrowserAuthState, setBrowserAuthUserId } from '@/lib/auth/client-storage';

interface AccountUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'faculty';
}

export function AccountMenu() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data?.user) return;
        setUser(data.user);
        setBrowserAuthUserId(data.user.id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    clearBrowserAuthState();
    window.location.assign('/login');
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded-md p-2 text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
        title={user ? `${user.name} (${user.email})` : 'Account'}
      >
        <User className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
          <div className="border-b border-border bg-secondary/35 px-4 py-3">
            <p className="truncate text-sm font-semibold text-foreground">
              {user?.name || 'Faculty'}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {user?.email || 'Signed in'}
            </p>
            {user?.role === 'admin' && (
              <p className="mt-2 inline-flex items-center gap-1 rounded bg-card px-1.5 py-0.5 text-xs font-medium text-primary ring-1 ring-border">
                <Shield className="h-3 w-3" />
                Admin
              </p>
            )}
          </div>
          {user?.role === 'admin' && (
            <Link
              href="/admin/users"
              className="flex w-full items-center gap-2 border-b border-border px-4 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Shield className="h-4 w-4" />
              Manage users
            </Link>
          )}
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
