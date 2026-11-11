import type { Metadata } from 'next';
import { pageTitle } from '@/lib/brand';
import AdminOverview from './AdminOverview';

// The overview is a client component (live numbers, charts); this thin server page only gives it a browser-tab title.
export const metadata: Metadata = { title: pageTitle('Overview') };

export default function AdminPage() {
  return <AdminOverview />;
}
