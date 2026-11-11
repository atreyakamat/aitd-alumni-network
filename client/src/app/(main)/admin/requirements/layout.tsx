import type { Metadata } from 'next';
import { pageTitle } from '@/lib/brand';

export const metadata: Metadata = { title: pageTitle('College requirements') };

export default function AdminRequirementsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
