'use client';

import Link from 'next/link';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function PublicNav() {
  return (
    <header className="fixed top-0 z-50 w-full border-b border-slate-200/70 bg-slate-50/70 backdrop-blur-xl shadow-xl shadow-blue-900/5">
      <div className="mx-auto flex h-20 w-full max-w-[1400px] items-center justify-between px-4 md:px-8">
        <Link href="/" className="text-2xl italic text-blue-900 font-headline">
          Alumni Connect
        </Link>

        <nav className="hidden items-center space-x-8 md:flex">
          <Link href="/" className="border-b-2 border-amber-600 pb-1 text-sm font-bold text-blue-900 font-label">
            Home
          </Link>
          <Link
            href="/directory"
            className="text-sm font-medium text-slate-600 transition-colors hover:text-blue-800 font-label"
          >
            Directory
          </Link>
          <Link href="/jobs" className="text-sm font-medium text-slate-600 transition-colors hover:text-blue-800 font-label">
            Jobs
          </Link>
          <Link href="/events" className="text-sm font-medium text-slate-600 transition-colors hover:text-blue-800 font-label">
            Events
          </Link>
          <Link href="/news" className="text-sm font-medium text-slate-600 transition-colors hover:text-blue-800 font-label">
            News
          </Link>
        </nav>

        <div className="flex items-center gap-4 md:gap-6">
          <div className="relative hidden lg:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              type="text"
              placeholder="Search the network..."
              className="h-10 w-64 rounded-full border-none bg-slate-100 pl-10 pr-4 text-sm focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
          <Link href="/login">
            <Button variant="ghost" className="font-label">
              Sign In
            </Button>
          </Link>
          <Link href="/register">
            <Button className="font-label">Join Now</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
