import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Give Back | AIEM Connection',
  description: 'Support scholarships, campus initiatives and alumni chapters. See the donor wall and campaign progress.',
  openGraph: {
    title: 'Give Back | AIEM Connection',
    description: 'Support scholarships, campus initiatives and alumni chapters. See the donor wall and campaign progress.',
    type: 'website',
  },
};

export default function DonationsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
