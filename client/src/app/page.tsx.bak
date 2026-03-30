import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { HeroSection } from '@/components/features/HeroSection';
import { StatsSection } from '@/components/features/StatsSection';
import { FeaturesSection } from '@/components/features/FeaturesSection';
import { UpcomingEvents } from '@/components/features/UpcomingEvents';
import { LatestNews } from '@/components/features/LatestNews';
import { Footer } from '@/components/layout/Footer';
import { PublicNav } from '@/components/layout/PublicNav';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background font-body">
      <PublicNav />
      <main>
        <HeroSection />
        <StatsSection />
        <FeaturesSection />
        <UpcomingEvents />
        <LatestNews />

        <section className="bg-primary py-20">
          <div className="container text-center">
            <h2 className="mb-4 font-headline text-4xl text-white md:text-5xl">
              Join Your Alumni Network Today
            </h2>
            <p className="mx-auto mb-8 max-w-2xl text-lg text-white/80 font-body">
              Connect with thousands of fellow alumni, discover opportunities, and be part of a thriving community.
            </p>
            <div className="flex justify-center gap-4">
              <Link href="/register">
                <Button size="lg" variant="secondary" className="font-label">
                  Get Started
                </Button>
              </Link>
              <Link href="/login">
                <Button size="lg" variant="outline" className="border-white text-white hover:bg-white/10 font-label">
                  Sign In
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
