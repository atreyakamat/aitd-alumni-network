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
    <section className="py-16 bg-primary text-white">
      <div className="container">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((stat, index) => (
            <div key={index} className="text-center">
              <div className="flex justify-center mb-4">
                <div className="bg-white/10 p-3 rounded-full">
                  <stat.icon className="h-6 w-6" />
                </div>
              </div>
              <p className="text-3xl md:text-4xl font-bold mb-2">
                <AnimatedNumber value={stat.value} suffix={stat.suffix} />
              </p>
              <p className="text-white/80 text-sm">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
