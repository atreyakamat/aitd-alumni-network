import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, Clock } from 'lucide-react';

// Mock data - in real app, this would come from API
const articles = [
  {
    id: '1',
    title: 'Alumni Spotlight: How Priya Sharma Built a $100M Startup',
    excerpt: 'From college dorm to Silicon Valley - the inspiring journey of our 2015 batch alumna.',
    category: 'ALUMNI_SPOTLIGHT',
    date: 'Dec 28, 2023',
    readTime: '5 min read',
    image: '/images/news/spotlight.jpg',
  },
  {
    id: '2',
    title: 'New Research Wing Inaugurated by Distinguished Alumnus',
    excerpt: 'Dr. Rajesh Patel, PhD (2010), inaugurates the state-of-the-art AI research facility.',
    category: 'COLLEGE_NEWS',
    date: 'Dec 25, 2023',
    readTime: '3 min read',
    image: '/images/news/research.jpg',
  },
  {
    id: '3',
    title: 'Annual Donation Drive Crosses ₹1 Crore Milestone',
    excerpt: 'Thanks to generous contributions from our alumni community worldwide.',
    category: 'GENERAL',
    date: 'Dec 20, 2023',
    readTime: '4 min read',
    image: '/images/news/donation.jpg',
  },
];

const categoryColors: Record<string, string> = {
  ALUMNI_SPOTLIGHT: 'bg-amber-100 text-amber-700',
  COLLEGE_NEWS: 'bg-blue-100 text-blue-700',
  INDUSTRY: 'bg-purple-100 text-purple-700',
  EVENTS: 'bg-green-100 text-green-700',
  GENERAL: 'bg-gray-100 text-gray-700',
};

const categoryLabels: Record<string, string> = {
  ALUMNI_SPOTLIGHT: 'Alumni Spotlight',
  COLLEGE_NEWS: 'College News',
  INDUSTRY: 'Industry',
  EVENTS: 'Events',
  GENERAL: 'General',
};

export function LatestNews() {
  return (
    <section className="py-20 bg-background">
      <div className="container">
        <div className="flex justify-between items-center mb-12">
          <div>
            <h2 className="text-3xl font-bold mb-2">Latest News & Stories</h2>
            <p className="text-muted-foreground">
              Stay updated with the latest from our alumni community
            </p>
          </div>
          <Link href="/news">
            <Button variant="outline">
              All Stories
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {articles.map((article) => (
            <Card key={article.id} className="overflow-hidden hover:shadow-lg transition-shadow">
              <div className="aspect-video bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                <div className="text-4xl">📰</div>
              </div>
              <CardContent className="p-6">
                <div className="flex gap-2 mb-3">
                  <Badge className={categoryColors[article.category]}>
                    {categoryLabels[article.category]}
                  </Badge>
                </div>
                <h3 className="font-semibold text-lg mb-2 line-clamp-2">
                  {article.title}
                </h3>
                <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                  {article.excerpt}
                </p>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>{article.date}</span>
                  <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    <span>{article.readTime}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
