import { brandConfig } from '@/lib/branding/brand-config';

export function OpenSourceNotices() {
  return (
    <section className="mx-auto w-full max-w-3xl px-5 py-12 text-sm leading-7 text-muted-foreground">
      <h1 className="text-2xl font-semibold text-foreground">Open source notices</h1>
      <p className="mt-4">{brandConfig.openSource.attribution}</p>
      <p className="mt-3">{brandConfig.openSource.endorsementCaveat}</p>
      <p className="mt-3">
        The root project license remains MIT with copyright retained by THU-MAIC. Third-party
        notices for LGPL packages, bundled GSAP, fonts, importer attribution, and other vendored
        components remain part of this repository and should accompany redistributed copies.
      </p>
    </section>
  );
}
