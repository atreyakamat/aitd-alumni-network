import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Events | AITD Connection',
  description: 'Alumni reunions, webinars, meetups and chapter events from the AITD alumni network.',
  openGraph: {
    title: 'Events | AITD Connection',
    description: 'Alumni reunions, webinars, meetups and chapter events from the AITD alumni network.',
    type: 'website',
  },
};

export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
