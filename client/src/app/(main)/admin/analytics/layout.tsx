import type { Metadata } from 'next';
import { pageTitle } from '@/lib/brand';

export const metadata: Metadata = { title: pageTitle('Analytics') };

export default function AdminAnalyticsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
