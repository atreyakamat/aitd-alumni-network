'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, Clock, User, ArrowRight } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import Link from 'next/link';

const categories = [
  'All Categories',
  'Alumni Spotlight',
  'College News',
  'Industry',
  'Events',
  'General',
];

// Mock data
const articles = [
  {
    id: '1',
    slug: 'priya-sharma-startup-success',
    title: 'Alumni Spotlight: How Priya Sharma Built a $100M Startup',
    excerpt:
      'From college dorm to Silicon Valley - the inspiring journey of our 2015 batch alumna who founded TechVentures.',
    coverImageUrl: null,
    category: 'ALUMNI_SPOTLIGHT',
    author: {
      fullName: 'Editorial Team',
    },
    publishedAt: '2023-12-28T10:00:00Z',
    viewsCount: 1250,
    tags: ['success-story', 'entrepreneurship', 'tech'],
  },
  {
    id: '2',
    slug: 'new-research-wing-inauguration',
    title: 'New Research Wing Inaugurated by Distinguished Alumnus',
    excerpt:
      'Dr. Rajesh Patel, PhD (2010), inaugurates the state-of-the-art AI research facility at our campus.',
    coverImageUrl: null,
    category: 'COLLEGE_NEWS',
    author: {
      fullName: 'College Communications',
    },
    publishedAt: '2023-12-25T10:00:00Z',
    viewsCount: 890,
    tags: ['campus', 'research', 'ai'],
  },
  {
    id: '3',
    slug: 'donation-drive-milestone',
    title: 'Annual Donation Drive Crosses ₹1 Crore Milestone',
    excerpt:
      'Thanks to generous contributions from our alumni community worldwide, we have achieved a new record.',
    coverImageUrl: null,
    category: 'GENERAL',
    author: {
      fullName: 'Alumni Association',
    },
    publishedAt: '2023-12-20T10:00:00Z',
    viewsCount: 650,
    tags: ['donation', 'milestone', 'community'],
  },
  {
    id: '4',
    slug: 'tech-industry-trends-2024',
    title: 'Tech Industry Trends for 2024: What Alumni Should Know',
    excerpt:
      'Industry experts share insights on emerging technologies and career opportunities in the coming year.',
    coverImageUrl: null,
    category: 'INDUSTRY',
    author: {
      fullName: 'Tech Committee',
    },
    publishedAt: '2023-12-18T10:00:00Z',
    viewsCount: 2100,
    tags: ['tech', 'trends', 'career'],
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

export default function NewsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All Categories');

  const filteredArticles = articles.filter((article) => {
    const matchesSearch =
      article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      article.excerpt.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory =
      selectedCategory === 'All Categories' ||
      categoryLabels[article.category] === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Featured article (first one)
  const featuredArticle = filteredArticles[0];
  const otherArticles = filteredArticles.slice(1);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">News & Stories</h1>
          <p className="text-muted-foreground">
            Stay updated with alumni achievements and college news
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search articles..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-full md:w-[200px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {filteredArticles.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No articles found</p>
        </div>
      ) : (
        <>
          {/* Featured Article */}
          {featuredArticle && (
            <Card className="overflow-hidden hover:shadow-lg transition-shadow">
              <div className="grid md:grid-cols-2 gap-0">
                <div className="aspect-video md:aspect-auto bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                  <div className="text-6xl">📰</div>
                </div>
                <CardContent className="p-6 flex flex-col justify-center">
                  <Badge
                    className={`w-fit mb-3 ${categoryColors[featuredArticle.category]}`}
                  >
                    {categoryLabels[featuredArticle.category]}
                  </Badge>
                  <h2 className="text-2xl font-bold mb-3">
                    {featuredArticle.title}
                  </h2>
                  <p className="text-muted-foreground mb-4">
                    {featuredArticle.excerpt}
                  </p>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                    <div className="flex items-center gap-1">
                      <User className="h-4 w-4" />
                      <span>{featuredArticle.author.fullName}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      <span>{formatDate(featuredArticle.publishedAt)}</span>
                    </div>
                  </div>
                  <Link href={`/dashboard/news/${featuredArticle.slug}`}>
                    <Button>
                      Read Full Story
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                </CardContent>
              </div>
            </Card>
          )}

          {/* Other Articles */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {otherArticles.map((article) => (
              <Card
                key={article.id}
                className="overflow-hidden hover:shadow-md transition-shadow"
              >
                <div className="aspect-video bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                  <div className="text-4xl">📰</div>
                </div>
                <CardContent className="p-6">
                  <Badge className={`mb-3 ${categoryColors[article.category]}`}>
                    {categoryLabels[article.category]}
                  </Badge>
                  <h3 className="font-semibold text-lg mb-2 line-clamp-2">
                    {article.title}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                    {article.excerpt}
                  </p>
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>{formatDate(article.publishedAt)}</span>
                    <span>{article.viewsCount} views</span>
                  </div>
                  <Link href={`/dashboard/news/${article.slug}`}>
                    <Button variant="outline" className="w-full mt-4">
                      Read More
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
