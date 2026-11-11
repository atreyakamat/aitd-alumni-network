import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Notifications | AIEM Connect',
  robots: { index: false, follow: false },
};

export default function NotificationsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
