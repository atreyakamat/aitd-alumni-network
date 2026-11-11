import type { Metadata } from 'next';
import { pageTitle } from '@/lib/brand';

export const metadata: Metadata = { title: pageTitle('Search') };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
