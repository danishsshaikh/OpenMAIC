export const brandConfig = {
  productName: 'MIT ADT Teaching AI',
  shortName: 'Teaching AI',
  productDescription:
    'A faculty-facing AI teaching platform for creating slides, quizzes, simulations, narrated lessons, and interactive classroom content.',
  institutionName: 'MIT ADT University',
  institutionFullName: 'MIT Art, Design and Technology University',
  institutionWebsite: 'https://mituniversity.ac.in/',
  approvedEmailDomain: 'mituniversity.edu.in',
  visualIdentity: {
    source: 'MIT ADT University public website',
    palette: {
      primary: '#5B1FA8',
      primaryStrong: '#42116F',
      secondary: '#C02672',
      secondarySoft: '#F9E7F1',
      surface: '#FCFAFF',
      surfaceWarm: '#FFFDF8',
      charcoal: '#1C1724',
      border: '#E6DFF0',
      goldAccent: '#D8A432',
    },
  },
  assets: {
    productMark: '/branding/mit-adt-teaching-ai-mark.svg',
    productWordmark: '/branding/mit-adt-teaching-ai-wordmark.svg',
    institutionLogo: '/branding/mit-adt.png',
    innovationCenterLogo: '/branding/crieya.jpeg',
  },
  export: {
    ctaDestination: 'mituniversity.ac.in',
    compositionId: 'mit-adt-teaching-ai',
    manifestFileName: 'mit-adt-teaching-ai-video-manifest.json',
  },
  openSource: {
    upstreamName: 'OpenMAIC',
    upstreamOrganization: 'THU-MAIC',
    upstreamRepository: 'https://github.com/THU-MAIC/OpenMAIC',
    attribution:
      'This product includes software derived from OpenMAIC by THU-MAIC, licensed under the MIT License.',
    endorsementCaveat:
      'OpenMAIC and THU-MAIC attribution is preserved for licensing transparency and does not imply endorsement.',
  },
} as const;

export type BrandConfig = typeof brandConfig;
