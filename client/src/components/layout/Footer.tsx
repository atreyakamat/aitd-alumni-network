import Link from 'next/link';
import { Share2, Globe, GraduationCap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function Footer() {
  return (
    <footer className="mt-20 w-full border-t border-slate-200 bg-slate-100">
      <div className="grid grid-cols-1 gap-8 px-8 py-16 md:grid-cols-3 lg:px-12">
        <div className="space-y-6">
          <div className="font-headline text-lg font-bold text-blue-900">Alumni Connect</div>
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
          <p className="text-sm tracking-wide text-slate-500 font-body">Sign up for our monthly editorial digest.</p>
          <div className="flex">
            <Input
              type="email"
              placeholder="Email Address"
              className="h-12 rounded-r-none border-none bg-white text-sm focus-visible:ring-1 focus-visible:ring-primary"
            />
            <Button className="h-12 rounded-l-none px-4 text-sm font-bold font-label">Join</Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center justify-between gap-4 bg-slate-200/50 px-8 py-8 md:flex-row lg:px-12">
        <span className="text-xs tracking-wide text-slate-500 font-body">
          © {new Date().getFullYear()} Alumni Connect. All rights reserved.
        </span>
        <div className="flex space-x-4">
          <Button variant="ghost" size="icon" className="text-slate-400 hover:text-primary">
            <Share2 className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" className="text-slate-400 hover:text-primary">
            <Globe className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" className="text-slate-400 hover:text-primary">
            <GraduationCap className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </footer>
  );
}
