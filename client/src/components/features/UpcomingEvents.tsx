import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { MapPin, Clock } from 'lucide-react';

const events = [
  {
    id: '1',
    title: 'The Centennial Alumni Gala',
    badge: 'Flagship',
    date: { day: '14', month: 'Oct' },
    location: 'Grand Hall',
    time: '19:00',
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCI74LQQ_90Dz1Xu_DLOTuhCC9mB0Gd3eu4C0_VyEE9vc8SsfJ426cyNmhZgtNCJnkkTyGO38t-RaGorM-JUD8Bx-yogBPL4AxsCOJz68egeCdhF-LaOtujZihZ5kBPRJrR7DD8RFpSeprBeUH1EBHhPydJQC1BS3MRDh44E3vE_RFfTFhUPyPl7SZA_gg_YpzYKxAnzSWki7rSNqTNFq3vD6u33JN8BLhK83sNCHWShTs67nYVz_HHrxIk2PZ54v2cus2ScMzZ4QRZ',
  },
  {
    id: '2',
    title: 'Innovation in Social Sciences',
    badge: 'Virtual',
    date: { day: '22', month: 'Oct' },
    location: 'Zoom Link',
    time: '15:30',
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuBddfdTJ1baUcxX8z7bADGA3_xNrRKMg7TSlle6ZzYjWMTQejeFiL4YoIdU-mhrPVAoM4zNBH5hlFB3Gw790O2OIJtolw0GiVqc5VdkTrxe9YyX_9aGgBSPngfRHEg_yoH3DLLHkRgPuKKmfGYti27-zHCGeZSNpl5g2Q2u7joQA3XsRy8HfTmbHTeYRUlRcpANYDLqxM6vnCxuT63cc3A7_RuFR3G5lKdsm0qAx99jhV_5kM7ptbSO27CtjbzSLguUdtN8WuqE5M-B',
  },
  {
    id: '3',
    title: 'London Chapter Networking Mixer',
    badge: 'Social',
    date: { day: '05', month: 'Nov' },
    location: 'The Shard',
    time: '18:30',
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuDWE39iTCtpnB6WL7FLHYw_waowuwH6CoZtLi3ksplaM973uMv-A4QFtnD_D70fl7d_NceGw5MVbV-29r6lay1nmL7783Vm3HyZFz_gsInIvemLJTvnecmvIg5TbSw3FHX-ZJpMueFTGh9a64LYgCmoXERllxD77LkGjkDHU02dhSsNYWnuGqpr47ZoN0PXNQlqinpPaoNH09tIUcyTxD9-5p0timvlyswkphw30pGkBWSo7a-vhePAKUmK8xvV4U0d-i0Xce7P37LF',
  },
];

export function UpcomingEvents() {
  return (
    <section className="bg-white py-24">
      <div className="container">
        <div className="mb-16 flex items-end justify-between">
          <div>
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-amber-700 font-label">
              Mark Your Calendar
            </span>
            <h2 className="font-headline text-5xl text-primary">Upcoming Gatherings</h2>
          </div>
          <Link href="/events">
            <Button variant="ghost" className="border-b border-primary pb-1 text-primary hover:text-amber-700 font-label">
              All Events
            </Button>
          </Link>
        </div>

        <div className="grid gap-12 lg:grid-cols-3">
          {events.map((event) => (
            <article key={event.id} className="group">
              <div className="relative mb-6 aspect-[4/5] overflow-hidden rounded-xl shadow-2xl shadow-primary/10">
                <Image
                  src={event.image}
                  alt={event.title}
                  fill
                  className="object-cover transition-transform duration-700 group-hover:scale-110"
                  sizes="(max-width: 1024px) 100vw, 33vw"
                />
                <div className="absolute left-6 top-6 rounded-lg bg-white p-3 text-center shadow-lg">
                  <span className="block text-2xl leading-none text-primary font-headline">{event.date.day}</span>
                  <span className="text-xs font-bold uppercase tracking-widest text-amber-700 font-label">
                    {event.date.month}
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                <span className="inline-block rounded bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary font-label">
                  {event.badge}
                </span>
                <h3 className="font-headline text-2xl text-primary">{event.title}</h3>
                <div className="flex items-center gap-4 text-sm text-slate-600 font-label">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    {event.location}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    {event.time}
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
