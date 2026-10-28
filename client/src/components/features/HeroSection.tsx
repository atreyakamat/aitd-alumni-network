import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import { BRAND } from '@/lib/brand';
import { HeroStats } from '@/components/features/HeroStats';

export function HeroSection() {
  return (
    <section className="relative min-h-[760px] overflow-hidden bg-background pt-32">
      {/* Self-contained decorative backdrop (placeholder — swap for a campus photo later) */}
      <div className="absolute inset-0 z-0" aria-hidden>
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-gold/10" />
        <div className="absolute -right-24 -top-24 h-[480px] w-[480px] rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-32 left-1/4 h-[420px] w-[420px] rounded-full bg-gold/10 blur-3xl" />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-transparent" />
      </div>

      <div className="container relative z-10">
        <div className="grid items-center gap-12 lg:grid-cols-12">
          <div className="space-y-8 lg:col-span-7">
            <div className="inline-flex items-center rounded-full bg-gold/15 px-4 py-1 text-xs font-bold uppercase tracking-widest text-gold-foreground font-label ring-1 ring-gold/30">
              {BRAND.tagline} • Alumni Circle
            </div>
            <h1 className="font-headline text-5xl leading-[0.9] text-primary md:text-7xl lg:text-8xl -tracking-tight">
              Cultivating the <br />
              <span className="italic text-gold">Academic Legacy.</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-slate-700 md:text-xl font-body">
              Join a curated ecosystem of scholars, professionals, and pioneers. Reconnect with your heritage and shape the
              future of the {BRAND.orgName} alumni community.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link href="/register">
                <Button size="lg" className="hero-gradient rounded-md px-8 py-4 tracking-wide shadow-xl shadow-primary/20 font-label">
                  Join the Network
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/directory">
                <Button
                  variant="secondary"
                  size="lg"
                  className="rounded-md bg-slate-200 px-8 py-4 tracking-wide text-primary hover:bg-slate-300 font-label"
                >
                  Explore Directory
                </Button>
              </Link>
            </div>
          </div>

          <HeroStats />
        </div>
      </div>
    </section>
  );
}
