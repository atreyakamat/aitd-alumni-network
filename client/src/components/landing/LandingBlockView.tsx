'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { StatsSection } from '@/components/features/StatsSection';
import { mediaSrc } from '@/lib/social';
import type { LandingBlock } from '@/lib/engagement';

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Renders one admin-authored landing block. The HTML block is sandboxed (no script execution). */
export function LandingBlockView({ block }: { block: LandingBlock }) {
  const c = block.config || {};

  switch (block.type) {
    case 'HERO':
      return (
        <section className="bg-gradient-to-br from-primary/5 via-background to-gold/10 py-20">
          <div className="container text-center">
            <h2 className="font-headline text-4xl text-primary md:text-5xl">{str(c.title, 'Welcome')}</h2>
            {str(c.subtitle) && <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">{str(c.subtitle)}</p>}
            {str(c.ctaText) && str(c.ctaHref) && (
              <Link href={str(c.ctaHref)} className="mt-6 inline-block">
                <Button size="lg" className="hero-gradient font-label">{str(c.ctaText)}</Button>
              </Link>
            )}
          </div>
        </section>
      );

    case 'TEXT':
      return (
        <section className="py-16">
          <div className="container max-w-3xl">
            {str(c.heading) && <h2 className="mb-4 font-headline text-3xl text-primary">{str(c.heading)}</h2>}
            <p className="whitespace-pre-line leading-relaxed text-slate-700">{str(c.body)}</p>
          </div>
        </section>
      );

    case 'IMAGE':
      return (
        <section className="py-10">
          <div className="container max-w-4xl text-center">
            {str(c.imageUrl) && (
              // eslint-disable-next-line @next/next/no-img-element -- admin-provided asset
              <img src={mediaSrc(str(c.imageUrl))} alt={str(c.caption)} className="mx-auto max-h-[480px] w-full rounded-xl object-cover" />
            )}
            {str(c.caption) && <p className="mt-3 text-sm text-muted-foreground">{str(c.caption)}</p>}
          </div>
        </section>
      );

    case 'STATS':
      return <StatsSection />;

    case 'CTA':
      return (
        <section className="bg-primary py-16">
          <div className="container text-center">
            <h2 className="mb-4 font-headline text-3xl text-white md:text-4xl">{str(c.title, 'Join the network')}</h2>
            {str(c.buttonText) && str(c.buttonHref) && (
              <Link href={str(c.buttonHref)}>
                <Button size="lg" variant="secondary" className="font-label">{str(c.buttonText)}</Button>
              </Link>
            )}
          </div>
        </section>
      );

    case 'HTML':
      return (
        <section className="py-6">
          <div className="container">
            {/* Sandboxed: pasted <script> cannot run, so admin HTML can't hijack visitor sessions. */}
            <iframe
              title="Custom section"
              sandbox=""
              className="w-full rounded-md border"
              style={{ height: num(c.height, 400) }}
              srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:Inter,Arial,sans-serif}${str(c.css)}</style></head><body>${str(c.html)}</body></html>`}
            />
          </div>
        </section>
      );

    default:
      return null;
  }
}
