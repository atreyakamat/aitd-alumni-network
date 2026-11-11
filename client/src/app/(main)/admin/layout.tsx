import { RequireRole } from '@/components/auth/RequireRole';
import { AdminNav } from '@/components/admin/AdminNav';

/**
 * Every /admin/** page requires ADMIN or above. Non-admins are sent to /dashboard and see nothing
 * of the admin UI meanwhile. This is a UX gate; the API enforces authorization on every call.
 *
 * The same frame surrounds every admin page: the section navigation, then the page in a content column of one width
 * with one vertical rhythm. Pages therefore start with <AdminPageHeader> and bring no wrapper or back link of their own.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole min="ADMIN" redirectTo="/dashboard">
      <div className="mx-auto w-full min-w-0 max-w-7xl space-y-6">
        <AdminNav />
        <div className="min-w-0 space-y-6">{children}</div>
      </div>
    </RequireRole>
  );
}
