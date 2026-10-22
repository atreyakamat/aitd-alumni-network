import { RequireRole } from '@/components/auth/RequireRole';

/**
 * Every /admin/** page requires ADMIN or above (UX gate; the API enforces).
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <RequireRole min="ADMIN">{children}</RequireRole>;
}
