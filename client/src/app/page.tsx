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
    <div className="min-h-screen bg-background">
      <PublicNav />
      <main>
        <HeroSection />
        <StatsSection />
        <FeaturesSection />
        <UpcomingEvents />
        <LatestNews />
        
        {/* CTA Section */}
        <section className="py-16 bg-primary">
          <div className="container text-center">
            <h2 className="text-3xl font-bold text-white mb-4">
              Join Your Alumni Network Today
            </h2>
            <p className="text-lg text-white/80 mb-8 max-w-2xl mx-auto">
              Connect with thousands of fellow alumni, discover opportunities, 
              and be part of a thriving community.
            </p>
            <div className="flex gap-4 justify-center">
              <Link href="/register">
                <Button size="lg" variant="secondary">
                  Get Started
                </Button>
              </Link>
              <Link href="/login">
                <Button size="lg" variant="outline" className="text-white border-white hover:bg-white/10">
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
