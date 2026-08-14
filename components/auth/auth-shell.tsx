import Image from 'next/image';
import type { ReactNode } from 'react';

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#f7f8fb] text-slate-950">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-6">
        <div className="flex items-center justify-between gap-6">
          <Image
            src="/branding/mit-adt.png"
            alt="MIT Art, Design and Technology University"
            width={220}
            height={80}
            className="h-12 w-auto object-contain sm:h-14"
            priority
          />
          <Image
            src="/branding/crieya.jpeg"
            alt="CRiEYA"
            width={180}
            height={80}
            className="h-12 w-auto object-contain sm:h-14"
            priority
          />
        </div>

        <div className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1fr_420px]">
          <section className="max-w-2xl">
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
              OpenMAIC
            </p>
            <h1 className="text-4xl font-semibold tracking-normal text-slate-950 sm:text-5xl">
              Faculty AI Classroom Platform
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-slate-600">
              Create, manage, and present AI-supported classroom experiences with a private faculty
              workspace.
            </p>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold tracking-normal text-slate-950">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{subtitle}</p>
            </div>
            {children}
          </section>
        </div>
      </div>
    </main>
  );
}
