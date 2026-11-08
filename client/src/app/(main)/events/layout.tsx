import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Events | AIEM Connection',
  description: 'Alumni reunions, webinars, meetups and chapter events from the AIEM alumni network.',
  openGraph: {
    title: 'Events | AIEM Connection',
    description: 'Alumni reunions, webinars, meetups and chapter events from the AIEM alumni network.',
    type: 'website',
  },
};

export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
