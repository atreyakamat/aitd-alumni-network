import type { Metadata } from 'next';
import { pageTitle } from '@/lib/brand';

export const metadata: Metadata = { title: pageTitle('Alumni list') };

export default function AdminAlumniListLayout({ children }: { children: React.ReactNode }) {
  return children;
}
