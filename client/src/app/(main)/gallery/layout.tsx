import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Photo Gallery | AIEM Connection',
  description: 'Photos from AIEM alumni reunions, convocations, campus life and chapter events.',
  openGraph: {
    title: 'Photo Gallery | AIEM Connection',
    description: 'Photos from AIEM alumni reunions, convocations, campus life and chapter events.',
    type: 'website',
  },
};

export default function GalleryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
