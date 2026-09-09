'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Shield } from 'lucide-react';

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'faculty';
  status: 'active' | 'disabled';
  createdAt: string;
  lastLoginAt?: string;
  lastActiveAt?: string;
  voiceConfigured: boolean;
  classroomsCreatedCount: number;
}

function formatDate(value?: string): string {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/users')
      .then(async (response) => {
        if (response.status === 403) {
          router.replace('/');
          return null;
        }
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to load users');
        return data.users as AdminUser[];
      })
      .then((data) => {
        if (data) setUsers(data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load users'));
  }, [router]);

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-6 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={() => router.push('/')}
              className="mb-4 inline-flex items-center gap-2 text-sm text-slate-600 transition hover:text-slate-950 dark:text-slate-400 dark:hover:text-slate-100"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-normal">
              <Shield className="h-6 w-6" />
              Users
            </h1>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-100 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Signed Up</th>
                    <th className="px-4 py-3 font-medium">Last Login</th>
                    <th className="px-4 py-3 font-medium">Last Active</th>
                    <th className="px-4 py-3 font-medium">Classrooms</th>
                    <th className="px-4 py-3 font-medium">Voice</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td className="px-4 py-3 font-medium">{user.name}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{user.email}</td>
                      <td className="px-4 py-3">{user.role}</td>
                      <td className="px-4 py-3">{user.status}</td>
                      <td className="px-4 py-3">{formatDate(user.createdAt)}</td>
                      <td className="px-4 py-3">{formatDate(user.lastLoginAt)}</td>
                      <td className="px-4 py-3">{formatDate(user.lastActiveAt)}</td>
                      <td className="px-4 py-3">{user.classroomsCreatedCount}</td>
                      <td className="px-4 py-3">
                        {user.voiceConfigured ? 'Configured' : 'Not configured'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
