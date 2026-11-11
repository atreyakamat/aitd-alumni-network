import type { Metadata } from 'next';
import { pageTitle } from '@/lib/brand';

export const metadata: Metadata = { title: pageTitle('Registration approvals') };

export default function AdminApprovalsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
