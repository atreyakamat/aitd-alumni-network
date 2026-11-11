/**
 * Single source of truth for product/organisation branding.
 *
 * The product is called "AIEM Connect" and belongs to the Agnel Institute of Engineering & Management (AIEM).
 * Change a value here, not across the UI.
 *
 * Contact details are best-effort from aiemgoa.ac.in; update if you have exact addresses.
 */
export const BRAND = {
  /** Product name shown in chrome (nav, footer, titles). */
  appName: 'AIEM Connect',
  /** Short product name. */
  shortName: 'AIEM',
  /** Legal/organisation name behind the platform. */
  orgName: 'AIEM Alumni Association',
  /** The institution the alumni belong to. */
  instituteName: 'Agnel Institute of Engineering & Management',
  tagline: 'Excellence Is Our Sole Goal',
  description:
    'Connect with fellow alumni, explore career opportunities, and stay updated with events.',

  domain: 'aiemgoa.ac.in',
  supportEmail: 'alumni@aiemgoa.ac.in',
  privacyEmail: 'privacy@aiemgoa.ac.in',
  legalEmail: 'legal@aiemgoa.ac.in',
  phone: '+91 99757 97916',
  address: 'Agnel Institute of Engineering & Management, Assagao, Bardez, Goa 403507',
} as const;

/** `"<page> | AIEM Connect"` title helper. */
export const pageTitle = (page?: string) => (page ? `${page} | ${BRAND.appName}` : BRAND.appName);
