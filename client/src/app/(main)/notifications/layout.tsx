import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Notifications | AITD Connection',
  robots: { index: false, follow: false },
};

export default function NotificationsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
