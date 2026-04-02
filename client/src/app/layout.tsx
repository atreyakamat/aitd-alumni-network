import type { Metadata } from 'next';
import { Inter, Public_Sans, Playfair_Display } from 'next/font/google';
import './globals.css';
import { Providers } from '@/context/providers';
import { Toaster } from '@/components/ui/toaster';

export const dynamic = 'force-dynamic';

const bodyFont = Inter({
  subsets: ['latin'],
  variable: '--font-body',
});

const labelFont = Public_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-label',
});

const headlineFont = Playfair_Display({
  subsets: ['latin'],
  style: ['italic', 'normal'],
  variable: '--font-headline',
});

export const metadata: Metadata = {
  title: 'AITD Connection - College Alumni Network',
  description: 'Connect with fellow alumni, explore career opportunities, and stay updated with events.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${bodyFont.className} ${bodyFont.variable} ${labelFont.variable} ${headlineFont.variable}`}
      >
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
