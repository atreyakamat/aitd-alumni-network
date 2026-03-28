import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { ArrowRight, BookOpen } from 'lucide-react';

export function HeroSection() {
  return (
    <section className="relative min-h-[760px] overflow-hidden bg-background pt-32">
      <div className="absolute inset-0 z-0">
        <Image
          src="https://lh3.googleusercontent.com/aida-public/AB6AXuCRJLheGW1Jq6n3IMGtta80GBzk0IbB5NQMrbmKTCBCk_kVXPufjO894SK8YfCuz3tx6grTBQTA7gFog7d1AfuPuT5qRbqB-j3EkDqIF8eVStgvdlGAMcg4heMjtdvcj_XrXJJ3hXs2-kl_0Ho7V09OozP-A_D3F8_N-ZhIKQbiXTpyaCAxNrfoGtQX67NVatG_6bTmLXXaIhiBL_42OwBIjWLNIJYRlSXRujV9OlsVF5ixuswtyhC1QUX30-c-cwnAnhD1BZbD8qD6"
          alt="University Campus"
          fill
          priority
          className="object-cover opacity-20 grayscale brightness-125"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-transparent" />
      </div>

      <div className="container relative z-10">
        <div className="grid items-center gap-12 lg:grid-cols-12">
          <div className="space-y-8 lg:col-span-7">
            <div className="inline-flex items-center rounded-full bg-amber-100 px-4 py-1 text-xs font-bold uppercase tracking-widest text-amber-900 font-label">
              Established 1892 • Alumni Circle
            </div>
            <h1 className="font-headline text-5xl leading-[0.9] text-[#002045] md:text-7xl lg:text-8xl -tracking-tight">
              Cultivating the <br />
              <span className="italic text-amber-700">Academic Legacy.</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-slate-700 md:text-xl font-body">
              Join a curated ecosystem of scholars, professionals, and pioneers. Reconnect with your heritage and shape the
              future of our global alumni community.
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

          <div className="grid grid-cols-2 gap-4 lg:col-span-5">
            <div className="flex min-h-[190px] flex-col justify-end rounded-xl border-b-4 border-amber-700 bg-white/80 p-8 backdrop-blur">
              <span className="font-headline text-4xl font-bold text-primary">24k+</span>
              <span className="text-xs uppercase tracking-tight text-slate-600 font-label">Global Alumni</span>
            </div>
            <div className="flex min-h-[190px] flex-col justify-end rounded-xl bg-primary p-8 text-white">
              <span className="font-headline text-4xl font-bold">850</span>
              <span className="text-xs uppercase tracking-tight text-white/70 font-label">Active Careers</span>
            </div>
            <div className="col-span-2 flex min-h-[190px] flex-col justify-end rounded-xl bg-slate-100/95 p-8">
              <div className="flex items-end justify-between">
                <div>
                  <span className="font-headline text-4xl font-bold text-primary">120</span>
                  <span className="mt-1 block text-xs uppercase tracking-tight text-slate-600 font-label">Annual Events</span>
                </div>
                <BookOpen className="h-12 w-12 text-amber-700" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
