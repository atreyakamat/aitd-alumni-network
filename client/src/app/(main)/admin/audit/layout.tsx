import type { Metadata } from 'next';
import { pageTitle } from '@/lib/brand';

export const metadata: Metadata = { title: pageTitle('Audit log') };

export default function AdminAuditLayout({ children }: { children: React.ReactNode }) {
  return children;
}
