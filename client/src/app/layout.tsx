import type { Metadata } from 'next';
import { Inter, Public_Sans } from 'next/font/google';
import './globals.css';
// import { Providers } from '@/context/providers';
// import { Toaster } from '@/components/ui/toaster';

const bodyFont = Inter({
  subsets: ['latin'],
  variable: '--font-body',
});

const labelFont = Public_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-label',
});

export const metadata: Metadata = {
  title: 'Alumni Connect - College Alumni Network',
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
        className={`${bodyFont.className} ${bodyFont.variable} ${labelFont.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
