import type { Metadata } from 'next';
import { pageTitle } from '@/lib/brand';

export const metadata: Metadata = { title: pageTitle('Landing page builder') };

export default function AdminLandingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
