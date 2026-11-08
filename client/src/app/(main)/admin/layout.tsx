import { RequireRole } from '@/components/auth/RequireRole';

/**
 * Every /admin/** page requires ADMIN or above. Non-admins are sent to /dashboard and see nothing
 * of the admin UI meanwhile. This is a UX gate; the API enforces authorization on every call.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole min="ADMIN" redirectTo="/dashboard">
      {children}
    </RequireRole>
  );
}
