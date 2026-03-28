'use client';

import { useEffect, useState } from 'react';
import { Users, Briefcase, GraduationCap, Globe } from 'lucide-react';

const stats = [
  {
    icon: Users,
    value: 10000,
    label: 'Registered Alumni',
    suffix: '+',
  },
  {
    icon: Briefcase,
    value: 500,
    label: 'Job Opportunities',
    suffix: '+',
  },
  {
    icon: GraduationCap,
    value: 50,
    label: 'Batch Years',
    suffix: '+',
  },
  {
    icon: Globe,
    value: 25,
    label: 'Countries',
    suffix: '+',
  },
];

function AnimatedNumber({ value, suffix }: { value: number; suffix: string }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const duration = 2000;
    const steps = 60;
    const increment = value / steps;
    let current = 0;
    
    const timer = setInterval(() => {
      current += increment;
      if (current >= value) {
        setCount(value);
        clearInterval(timer);
      } else {
        setCount(Math.floor(current));
      }
    }, duration / steps);

    return () => clearInterval(timer);
  }, [value]);

  return (
    <span>
      {count.toLocaleString()}{suffix}
    </span>
  );
}

export function StatsSection() {
  return (
    <section className="py-20 bg-slate-100">
      <div className="container">
        <div className="mb-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <h2 className="font-headline text-4xl text-primary">A Legacy of Connection</h2>
            <p className="mt-3 text-slate-600 font-body">
              Our digital architecture is designed to foster meaningful scholarly exchange and professional advancement.
            </p>
          </div>
          <div className="hidden h-[2px] flex-grow bg-slate-300/40 md:block" />
        </div>

        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          {stats.map((stat, index) => (
            <div
              key={index}
              className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/5"
            >
              <div className="mb-4 inline-flex rounded-full bg-slate-100 p-3 text-primary">
                <stat.icon className="h-5 w-5" />
              </div>
              <p className="mb-1 font-headline text-4xl font-bold text-primary">
                <AnimatedNumber value={stat.value} suffix={stat.suffix} />
              </p>
              <p className="text-xs uppercase tracking-wide text-slate-600 font-label">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
