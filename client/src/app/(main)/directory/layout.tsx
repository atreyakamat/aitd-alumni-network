import type { Metadata } from 'next';
import { pageTitle } from '@/lib/brand';

export const metadata: Metadata = { title: pageTitle('Alumni directory') };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
