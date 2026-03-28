import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Users, Briefcase, BookOpen, CalendarDays, ArrowRight } from 'lucide-react';

const features = [
  {
    icon: Users,
    title: 'Directory',
    description: 'Locate peers across generations and geographies through our verified global database.',
    href: '/directory',
    cta: 'Search Members',
  },
  {
    icon: Briefcase,
    title: 'Job Board',
    description: 'Exclusive access to high-tier professional opportunities from alumni and partner organizations.',
    href: '/jobs',
    cta: 'View Openings',
  },
  {
    icon: BookOpen,
    title: 'Mentorship',
    description: 'Bridge the gap between experience and ambition through structured guidance programs.',
    href: '/jobs',
    cta: 'Find a Mentor',
  },
  {
    icon: CalendarDays,
    title: 'Events',
    description: 'From gala dinners to digital seminars, stay connected with our curated global calendar.',
    href: '/events',
    cta: 'Browse Calendar',
  },
];

export function FeaturesSection() {
  return (
    <section className="bg-slate-50 py-24">
      <div className="container">
        <div className="mb-16 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <h2 className="font-headline text-4xl text-primary">A Legacy of Connection</h2>
            <p className="mt-4 max-w-2xl text-slate-600 font-body">
              Our platform is designed to foster meaningful scholarly exchange and professional advancement.
            </p>
          </div>
          <div className="mx-12 hidden h-[2px] flex-grow bg-slate-300/30 md:block" />
        </div>

        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          {features.map((feature, index) => (
            <Card
              key={index}
              className="group border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-2xl hover:shadow-primary/5"
            >
              <CardContent className="p-8">
                <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-primary transition-colors group-hover:bg-primary group-hover:text-white">
                  <feature.icon className="h-6 w-6" />
                </div>
                <h3 className="mb-3 font-headline text-2xl text-primary">{feature.title}</h3>
                <p className="mb-6 text-sm leading-relaxed text-slate-600 font-body">{feature.description}</p>
                <Link
                  href={feature.href}
                  className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-700 font-label"
                >
                  {feature.cta}
                  <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-1" />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
