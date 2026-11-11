/**
 * Single source of truth for product/organisation branding on the server
 * (emails, PDF receipts, invite copy). Mirror of client/src/lib/brand.ts.
 *
 * The product is called "AIEM Connect" (Agnel Institute of Engineering & Management). Change values here, not inline.
 */
export const BRAND = {
  appName: 'AIEM Connect',
  shortName: 'AIEM',
  orgName: 'AIEM Alumni Association',
  instituteName: 'Agnel Institute of Engineering & Management',
  tagline: 'Excellence Is Our Sole Goal',

  domain: 'aiemgoa.ac.in',
  supportEmail: 'alumni@aiemgoa.ac.in',
  privacyEmail: 'privacy@aiemgoa.ac.in',
  legalEmail: 'legal@aiemgoa.ac.in',
  phone: '+91 99757 97916',
  address: 'Agnel Institute of Engineering & Management, Assagao, Bardez, Goa 403507',
} as const;
