// Auth pages are interactive forms that read query params / tokens (e.g. useSearchParams on
// /reset-password) and are not SEO targets, so render them dynamically. This scopes dynamic
// rendering here instead of globally, so public marketing/legal pages still optimise statically.
export const dynamic = 'force-dynamic';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
