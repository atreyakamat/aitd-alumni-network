'use client';

import * as React from 'react';
import { BookOpen } from 'lucide-react';
import { userApi } from '@/lib/api';

interface PublicStats {
  totalAlumni: number;
  totalCompanies: number;
  totalBatches: number;
  totalCities: number;
}

const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k+` : String(n);

/** The hero's three figure cards, backed by the public /users/stats endpoint (no fabricated numbers). */
export function HeroStats() {
  const [stats, setStats] = React.useState<PublicStats | null>(null);

  React.useEffect(() => {
    let active = true;
    userApi
      .getStats()
      .then((res) => {
        const data = (res.data?.data ?? res.data) as PublicStats;
        if (active) setStats(data);
      })
      .catch(() => {
        /* The hero still renders with placeholders if stats are unavailable. */
      });
    return () => {
      active = false;
    };
  }, []);

  const alumni = stats ? compact(stats.totalAlumni) : '—';
  const companies = stats ? String(stats.totalCompanies) : '—';
  const cities = stats ? String(stats.totalCities) : '—';

  return (
    <div className="grid grid-cols-2 gap-4 lg:col-span-5">
      <div className="flex min-h-[190px] flex-col justify-end rounded-xl border-b-4 border-gold bg-white/80 p-8 backdrop-blur">
        <span className="font-headline text-4xl font-bold text-primary">{alumni}</span>
        <span className="text-xs uppercase tracking-tight text-slate-600 font-label">Registered Alumni</span>
      </div>
      <div className="flex min-h-[190px] flex-col justify-end rounded-xl bg-primary p-8 text-white">
        <span className="font-headline text-4xl font-bold">{companies}</span>
        <span className="text-xs uppercase tracking-tight text-white/70 font-label">Companies</span>
      </div>
      <div className="col-span-2 flex min-h-[190px] flex-col justify-end rounded-xl bg-slate-100/95 p-8">
        <div className="flex items-end justify-between">
          <div>
            <span className="font-headline text-4xl font-bold text-primary">{cities}</span>
            <span className="mt-1 block text-xs uppercase tracking-tight text-slate-600 font-label">Cities worldwide</span>
          </div>
          <BookOpen className="h-12 w-12 text-gold" aria-hidden />
        </div>
      </div>
    </div>
  );
}
