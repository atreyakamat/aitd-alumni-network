import type { Metadata } from 'next';
import { pageTitle } from '@/lib/brand';

export const metadata: Metadata = { title: pageTitle('System status') };

export default function AdminStatusLayout({ children }: { children: React.ReactNode }) {
  return children;
}
