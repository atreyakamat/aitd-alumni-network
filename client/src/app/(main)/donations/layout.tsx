import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Give Back | AIEM Connect',
  description: 'Support scholarships, campus initiatives and alumni chapters. Donate as a guest, no account needed.',
  openGraph: {
    title: 'Give Back | AIEM Connect',
    description: 'Support scholarships, campus initiatives and alumni chapters. Donate as a guest, no account needed.',
    type: 'website',
  },
};

export default function DonationsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
