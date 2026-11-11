import type { Metadata } from 'next';
import { pageTitle } from '@/lib/brand';

export const metadata: Metadata = { title: pageTitle('Members') };

export default function AdminUsersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
