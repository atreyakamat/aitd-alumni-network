import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function Footer() {
  return (
    <footer className="mt-20 w-full border-t border-slate-200 bg-slate-100">
      <div className="grid grid-cols-1 gap-8 px-8 py-16 md:grid-cols-3 lg:px-12">
        <div className="space-y-6">
          <div className="font-headline text-lg font-bold text-blue-900">AIEM Connection</div>
          <p className="max-w-xs text-sm tracking-wide text-slate-500 font-body">
            Connecting past excellence with future potential through a global network of scholarly leaders.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col space-y-3">
            <span className="mb-2 text-xs font-bold uppercase tracking-widest text-primary font-label">Network</span>
            <Link href="/directory" className="text-sm tracking-wide text-slate-500 transition-colors hover:text-blue-700 font-body">
              Directory
            </Link>
            <Link href="/yearbook" className="text-sm tracking-wide text-slate-500 transition-colors hover:text-blue-700 font-body">
              Yearbook
            </Link>
            <Link href="/jobs" className="text-sm tracking-wide text-slate-500 transition-colors hover:text-blue-700 font-body">
              Jobs
            </Link>
            <Link href="/events" className="text-sm tracking-wide text-slate-500 transition-colors hover:text-blue-700 font-body">
              Events
            </Link>
          </div>
          <div className="flex flex-col space-y-3">
            <span className="mb-2 text-xs font-bold uppercase tracking-widest text-primary font-label">Legal</span>
            <Link href="/privacy" className="text-sm tracking-wide text-slate-500 transition-colors hover:text-blue-700 font-body">
              Privacy Policy
            </Link>
            <Link href="/terms" className="text-sm tracking-wide text-slate-500 transition-colors hover:text-blue-700 font-body">
              Terms of Service
            </Link>
            <Link href="/contact" className="text-sm tracking-wide text-slate-500 transition-colors hover:text-blue-700 font-body">
              Contact Us
            </Link>
          </div>
        </div>

        <div className="space-y-6">
          <span className="block text-xs font-bold uppercase tracking-widest text-primary font-label">Join the Legacy</span>
          <p className="text-sm tracking-wide text-slate-500 font-body">Create your free alumni account to stay connected.</p>
          <Button className="h-12 px-6 text-sm font-bold font-label" asChild>
            <Link href="/register">Join</Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-col items-center justify-between gap-4 bg-slate-200/50 px-8 py-8 md:flex-row lg:px-12">
        <span className="text-xs tracking-wide text-slate-500 font-body">
          © {new Date().getFullYear()} AIEM Connection. All rights reserved.
        </span>
      </div>
    </footer>
  );
}
