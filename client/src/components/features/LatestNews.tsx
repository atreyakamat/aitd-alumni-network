import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';

const stories = [
  {
    id: '1',
    tag: 'Alumni Spotlight',
    title: 'Dr. Elena Vance on Renewable Ethics',
    excerpt:
      "Class of '12 alumna discusses the intersection of philosophical ethics and global energy policy in her latest publication.",
    cta: 'Read Profile',
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuBMXCv1pyUwVSQzv6lJtfe7CPivK4IK85D3f-RVsaxWKizDhNk7bliMzSx33dMt9Leg4LDnniAcnRirdgrXzAM-zTkczjAExRuOXXDweS-c7S52_AwWtXnkdbbUz49wjRnuQtS7LdTvZdDp91R0K_173JN-xadZMDnMDgd4_EqQICTEHGj2f5qZV7dkp2uEaWIyTVWsmWQS9mEVkArRu5wH1MMz5cmsqo0NKfx8bZRdgNGa6KbCIopCfRJrUc0UbdgaOyf_SVQP4uRQ',
  },
  {
    id: '2',
    tag: 'Entrepreneurship',
    title: 'From Thesis to Tech Unicorn',
    excerpt: 'How a final year project in 2018 became one of the fastest-growing AI startups in Europe.',
    cta: 'The Journey',
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuAbONeJOpA42tNPBP_fECbfg2vb4V0dWzQkxFAQFBbcyEO-Ut7GoKjTpSzJlKzcq0UurF5yBl6tdwaFqbE4wT4o6r3QVdfdEtfe2HYU9Gp7G9N2XS9c0GcPkcnH5hHxelI6_YsCuN_X9yuAoHWugDlo_5bOov569eiyxmhCPOrnde-w5GaSJGKWSk-GKP1UbqYRGjAY5-MkODqTxLIlAzuejeiL4o9_DSfgTTeDrahMRNyqE8-W2IbVtpFdMsm7GynHMlSQCCtvHhIU',
  },
];

export function LatestNews() {
  return (
    <section className="overflow-hidden bg-slate-100 py-24">
      <div className="container">
        <div className="grid gap-16 lg:grid-cols-12">
          <div className="self-start lg:sticky lg:top-32 lg:col-span-4">
            <h2 className="mb-8 font-headline text-5xl leading-tight text-primary">
              Voices of the <br />
              <span className="italic text-amber-700">Editorial.</span>
            </h2>
            <p className="mb-8 leading-relaxed text-slate-600 font-body">
              Exploring the impacts, journeys, and breakthroughs of our alumni community around the globe.
            </p>
            <Link href="/news">
              <Button className="rounded-md px-8 py-4 tracking-wide font-label">Read More Stories</Button>
            </Link>
          </div>

          <div className="space-y-24 lg:col-span-8">
            <article className="grid items-center gap-10 md:grid-cols-2">
              <div className="order-2 md:order-1">
                <span className="mb-4 block text-[10px] font-bold uppercase tracking-[0.3em] text-amber-700 font-label">
                  {stories[0].tag}
                </span>
                <h3 className="mb-4 font-headline text-3xl leading-snug text-primary">{stories[0].title}</h3>
                <p className="mb-6 text-sm leading-relaxed text-slate-600 font-body">{stories[0].excerpt}</p>
                <Link href="/news" className="border-b-2 border-primary pb-1 text-xs font-bold uppercase tracking-widest text-primary font-label">
                  {stories[0].cta}
                </Link>
              </div>
              <div className="order-1 md:order-2">
                <div className="relative aspect-square rotate-3 overflow-hidden rounded-2xl bg-slate-200 transition-transform duration-500 hover:rotate-0">
                  <Image src={stories[0].image} alt={stories[0].title} fill className="object-cover" sizes="(max-width: 768px) 100vw, 50vw" />
                </div>
              </div>
            </article>

            <article className="grid items-center gap-10 md:grid-cols-2">
              <div>
                <div className="relative aspect-video -rotate-2 overflow-hidden rounded-2xl bg-slate-200 transition-transform duration-500 hover:rotate-0">
                  <Image src={stories[1].image} alt={stories[1].title} fill className="object-cover" sizes="(max-width: 768px) 100vw, 50vw" />
                </div>
              </div>
              <div>
                <span className="mb-4 block text-[10px] font-bold uppercase tracking-[0.3em] text-amber-700 font-label">
                  {stories[1].tag}
                </span>
                <h3 className="mb-4 font-headline text-3xl leading-snug text-primary">{stories[1].title}</h3>
                <p className="mb-6 text-sm leading-relaxed text-slate-600 font-body">{stories[1].excerpt}</p>
                <Link href="/news" className="border-b-2 border-primary pb-1 text-xs font-bold uppercase tracking-widest text-primary font-label">
                  {stories[1].cta}
                </Link>
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}
