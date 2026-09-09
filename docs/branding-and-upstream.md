# MIT ADT Branding and Upstream Integration

This repository keeps the OpenMAIC core intact while layering MIT ADT product
branding on top.

## Branch Flow

Upstream changes should normally flow through:

```text
upstream/main -> local-build -> downstream feature/rebrand branches
```

Integrate OpenMAIC updates into `local-build` first, then bring them into active
MIT ADT downstream branches.

## Brand Layer

- Central config: `lib/branding/brand-config.ts`
- Shared product wordmark: `components/branding/brand-wordmark.tsx`
- Shared institution lockup: `components/branding/institution-lockup.tsx`
- Open source notices: `components/branding/open-source-notices.tsx`
- Downstream product assets: `public/branding/`

The temporary product name is `MIT ADT Teaching AI`. Replace it in the central
config when the final approved product name is selected.

## Theme Tokens

Application colors live in semantic CSS variables in `app/globals.css`. Keep
new UI work on tokens such as `primary`, `background`, `card`, `muted`,
`accent`, `border`, and `ring` rather than scattering raw color values across
components.

The current palette is inspired by MIT ADT University's public website:
institutional purple, magenta accent, clean white surfaces, charcoal text, and a
small gold accent for university emphasis.

## English-Only Deployment Policy

The upstream i18n architecture and locale files remain in place. This deployment
clamps runtime behavior through `lib/i18n/deployment.ts`:

- default locale: `en-US`
- fallback locale: `en-US`
- exposed locale list: `en-US` only
- stale stored locale values resolve back to `en-US`
- the language selector is hidden while only one locale is exposed

Generation fallbacks and outline prompt policy default normal teaching output to
English without stripping mathematical notation, code, proper nouns, or technical
symbols.

## Internal Identifiers

Do not cosmetically rename internal OpenMAIC identifiers. Package names,
environment variables, cookies, storage keys, API headers, database keys, and
runtime ids remain stable for migration safety and upstream compatibility.

Examples include `@openmaic/*`, `@maic/*`, `OPENMAIC_*`,
`NEXT_PUBLIC_MAIC_*`, `openmaic_session`, `openmaic_access`,
`x-openmaic-client`, and `openmaic:*`.

## Attribution

The root MIT license, THU-MAIC copyright notice, third-party notices,
`mathml2omml` LGPL notice, GSAP notice, font notices, importer attribution, and
other vendored dependency notices must remain available in redistributed copies.

## Downstream Extensions

This deployment includes university-specific work for authentication, private
faculty workspaces, faculty Teaching Voice / voice cloning, async simulation
jobs, simulation language enforcement, provider integration, exports, and local
AI model operation. Avoid refactoring those features during branding-only work.
