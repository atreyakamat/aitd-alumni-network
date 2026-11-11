import type { Metadata } from 'next';
import { pageTitle } from '@/lib/brand';

export const metadata: Metadata = { title: pageTitle('Reports') };

export default function AdminReportsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
