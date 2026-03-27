import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { ArrowRight, Users, Briefcase, CalendarDays, Heart } from 'lucide-react';

export function HeroSection() {
  return (
    <section className="relative bg-gradient-to-br from-primary/10 via-background to-background py-20 lg:py-28">
      <div className="container">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-6">
              Where Alumni
              <span className="text-primary"> Connect</span>,
              <br />
              Grow & Give Back
            </h1>
            <p className="text-lg text-muted-foreground mb-8 max-w-lg">
              Join thousands of alumni from our college community. Network with fellow graduates, 
              discover career opportunities, and stay connected with your alma mater.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/register">
                <Button size="lg" className="w-full sm:w-auto">
                  Join the Network
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/about">
                <Button variant="outline" size="lg" className="w-full sm:w-auto">
                  Learn More
                </Button>
              </Link>
            </div>
            
            {/* Quick Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-12">
              <div className="flex items-center gap-2">
                <div className="bg-primary/10 p-2 rounded-lg">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">10K+</p>
                  <p className="text-xs text-muted-foreground">Alumni</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="bg-primary/10 p-2 rounded-lg">
                  <Briefcase className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">500+</p>
                  <p className="text-xs text-muted-foreground">Jobs Posted</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="bg-primary/10 p-2 rounded-lg">
                  <CalendarDays className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">50+</p>
                  <p className="text-xs text-muted-foreground">Events/Year</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="bg-primary/10 p-2 rounded-lg">
                  <Heart className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">₹50L+</p>
                  <p className="text-xs text-muted-foreground">Donated</p>
                </div>
              </div>
            </div>
          </div>
          
          <div className="relative hidden lg:block">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-primary/5 rounded-3xl"></div>
            <div className="relative bg-white rounded-3xl shadow-2xl p-8">
              <div className="grid grid-cols-2 gap-4">
                <div className="aspect-square bg-gradient-to-br from-primary/20 to-primary/10 rounded-2xl flex items-center justify-center">
                  <Users className="h-16 w-16 text-primary" />
                </div>
                <div className="aspect-square bg-gradient-to-br from-amber-100 to-amber-50 rounded-2xl flex items-center justify-center">
                  <Briefcase className="h-16 w-16 text-amber-600" />
                </div>
                <div className="aspect-square bg-gradient-to-br from-green-100 to-green-50 rounded-2xl flex items-center justify-center">
                  <CalendarDays className="h-16 w-16 text-green-600" />
                </div>
                <div className="aspect-square bg-gradient-to-br from-rose-100 to-rose-50 rounded-2xl flex items-center justify-center">
                  <Heart className="h-16 w-16 text-rose-600" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
