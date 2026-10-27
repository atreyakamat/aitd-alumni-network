/** Fallback matches the address already used by the legal pages' footer. */
export const DEFAULT_CONTACT_EMAIL = 'contact@aiemgoa.ac.in';

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** Contact address from NEXT_PUBLIC_CONTACT_EMAIL, falling back when unset or malformed. */
export function getContactEmail(value: string | undefined = process.env.NEXT_PUBLIC_CONTACT_EMAIL): string {
  const email = value?.trim();
  return email && EMAIL_RE.test(email) ? email : DEFAULT_CONTACT_EMAIL;
}

/** mailto: link with an encoded subject line. */
export function mailtoHref(email: string, subject?: string): string {
  return subject ? `mailto:${email}?subject=${encodeURIComponent(subject)}` : `mailto:${email}`;
}
