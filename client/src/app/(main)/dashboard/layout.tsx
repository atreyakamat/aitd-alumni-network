import type { Metadata } from 'next';
import { pageTitle } from '@/lib/brand';

export const metadata: Metadata = { title: pageTitle('Home') };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
