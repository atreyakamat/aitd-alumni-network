'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { GraduationCap } from 'lucide-react';

export function PublicNav() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="bg-primary rounded-lg p-2">
            <GraduationCap className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold text-primary">Alumni Connect</span>
        </Link>

        <nav className="hidden md:flex items-center gap-6">
          <Link href="/about" className="text-sm font-medium text-muted-foreground hover:text-foreground">
            About
          </Link>
          <Link href="/events" className="text-sm font-medium text-muted-foreground hover:text-foreground">
            Events
          </Link>
          <Link href="/news" className="text-sm font-medium text-muted-foreground hover:text-foreground">
            News
          </Link>
          <Link href="/gallery" className="text-sm font-medium text-muted-foreground hover:text-foreground">
            Gallery
          </Link>
          <Link href="/contact" className="text-sm font-medium text-muted-foreground hover:text-foreground">
            Contact
          </Link>
        </nav>

        <div className="flex items-center gap-4">
          <Link href="/login">
            <Button variant="ghost">Sign In</Button>
          </Link>
          <Link href="/register">
            <Button>Join Now</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
