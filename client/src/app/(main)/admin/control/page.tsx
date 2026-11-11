import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { pageTitle } from '@/lib/brand';

export const metadata: Metadata = { title: pageTitle('System status') };

/**
 * The old developer-facing control page is gone; what an administrator needs to know ("is everything working?") is the
 * System status page. Old bookmarks and links land there.
 */
export default function AdminControlPage() {
  redirect('/admin/status');
}
