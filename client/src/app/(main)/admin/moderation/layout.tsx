import type { Metadata } from 'next';
import { pageTitle } from '@/lib/brand';

export const metadata: Metadata = { title: pageTitle('Moderation') };

export default function AdminModerationLayout({ children }: { children: React.ReactNode }) {
  return children;
}
