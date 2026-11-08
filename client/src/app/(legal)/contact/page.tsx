import { Metadata } from 'next';
import Link from 'next/link';
import { getContactEmail, mailtoHref } from '@/lib/contact';

export const metadata: Metadata = {
  title: 'Contact Us | AIEM Connection',
  description: 'How to reach the AIEM Alumni Association team behind AIEM Connection',
};

const topics = [
  {
    title: 'General enquiries',
    body: 'Questions about the alumni network, chapters, events or partnerships.',
    subject: 'General enquiry',
  },
  {
    title: 'Account and sign-in help',
    body: 'Trouble signing in, verifying your email or updating your profile. Include the email address on your account.',
    subject: 'Account help',
  },
  {
    title: 'Privacy and data requests',
    body: 'Access, correction or deletion of your personal data, as described in our Privacy Policy.',
    subject: 'Privacy request',
  },
  {
    title: 'Report a problem or content',
    body: 'Bugs, inappropriate posts or listings, or anything that breaks our Terms of Service.',
    subject: 'Report a problem',
  },
] as const;

export default function ContactPage() {
  const email = getContactEmail();

  return (
    <div className="min-h-screen bg-slate-50 py-12">
      <div className="container mx-auto px-6 max-w-4xl">
        <article className="bg-white rounded-2xl shadow-lg p-8 md:p-12">
          <header className="mb-10 text-center">
            <h1 className="font-headline text-4xl font-bold text-gray-900 mb-4">Contact Us</h1>
            <p className="text-gray-500">
              The AIEM Alumni Association team reads every message. We usually reply within a few working days.
            </p>
          </header>

          <section className="mb-10 rounded-xl border border-slate-200 bg-slate-50 p-6 text-center">
            <h2 className="font-headline text-xl font-semibold text-[#002045] mb-2">Email us</h2>
            <a
              href={mailtoHref(email)}
              className="text-lg font-medium text-amber-700 hover:underline break-all"
            >
              {email}
            </a>
          </section>

          <section className="mb-10">
            <h2 className="font-headline text-2xl font-semibold text-[#002045] mb-4">What can we help with?</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {topics.map((topic) => (
                <div key={topic.title} className="rounded-xl border border-slate-200 p-5">
                  <h3 className="font-semibold text-gray-900 mb-1">{topic.title}</h3>
                  <p className="text-sm text-gray-600 mb-3">{topic.body}</p>
                  <a
                    href={mailtoHref(email, topic.subject)}
                    className="text-sm font-medium text-amber-700 hover:underline"
                  >
                    Email about this
                  </a>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="font-headline text-2xl font-semibold text-[#002045] mb-4">Help yourself first</h2>
            <ul className="list-disc pl-6 space-y-2 text-gray-600">
              <li>
                Forgot your password?{' '}
                <Link href="/forgot-password" className="text-amber-700 hover:underline">
                  Reset it here
                </Link>
                .
              </li>
              <li>
                Manage your profile, privacy, notifications and account in{' '}
                <Link href="/settings" className="text-amber-700 hover:underline">
                  Settings
                </Link>{' '}
                (sign-in required).
              </li>
              <li>
                Read how we handle your data in our{' '}
                <Link href="/privacy" className="text-amber-700 hover:underline">
                  Privacy Policy
                </Link>{' '}
                and{' '}
                <Link href="/cookies" className="text-amber-700 hover:underline">
                  Cookie Policy
                </Link>
                .
              </li>
              <li>
                Community rules are in our{' '}
                <Link href="/terms" className="text-amber-700 hover:underline">
                  Terms of Service
                </Link>
                .
              </li>
            </ul>
          </section>
        </article>
      </div>
    </div>
  );
}
