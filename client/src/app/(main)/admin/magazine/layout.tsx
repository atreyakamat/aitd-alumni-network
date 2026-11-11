import type { Metadata } from 'next';
import { pageTitle } from '@/lib/brand';

export const metadata: Metadata = { title: pageTitle('Magazine') };

export default function AdminMagazineLayout({ children }: { children: React.ReactNode }) {
  return children;
}
