import type { Metadata } from 'next';
import { pageTitle } from '@/lib/brand';

export const metadata: Metadata = { title: pageTitle('Videos') };

export default function AdminVideosLayout({ children }: { children: React.ReactNode }) {
  return children;
}
