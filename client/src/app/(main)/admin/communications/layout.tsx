import type { Metadata } from 'next';
import { pageTitle } from '@/lib/brand';

export const metadata: Metadata = { title: pageTitle('Communications') };

export default function AdminCommunicationsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
