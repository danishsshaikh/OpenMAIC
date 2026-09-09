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
        className="p-2 rounded-full text-gray-400 dark:text-gray-500 hover:bg-white dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 hover:shadow-sm transition-all"
        title={user ? `${user.name} (${user.email})` : 'Account'}
      >
        <User className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
          <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-700">
            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {user?.name || 'Faculty'}
            </p>
            <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
              {user?.email || 'Signed in'}
            </p>
            {user?.role === 'admin' && (
              <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-gray-700 dark:text-gray-300">
                <Shield className="h-3 w-3" />
                Admin
              </p>
            )}
          </div>
          {user?.role === 'admin' && (
            <Link
              href="/admin/users"
              className="flex w-full items-center gap-2 border-b border-gray-100 px-4 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <Shield className="h-4 w-4" />
              Manage users
            </Link>
          )}
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
