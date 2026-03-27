import { Card, CardContent } from '@/components/ui/card';
import { 
  Users, 
  Briefcase, 
  CalendarDays, 
  MessageSquare, 
  Heart,
  MapPin,
  BookOpen,
  Award
} from 'lucide-react';

const features = [
  {
    icon: Users,
    title: 'Alumni Directory',
    description: 'Search and connect with thousands of alumni across batches, departments, and locations.',
    color: 'bg-blue-100 text-blue-600',
  },
  {
    icon: Briefcase,
    title: 'Job Board',
    description: 'Explore exclusive job opportunities and internships posted by fellow alumni.',
    color: 'bg-amber-100 text-amber-600',
  },
  {
    icon: CalendarDays,
    title: 'Events',
    description: 'Stay updated on reunions, workshops, webinars, and networking events.',
    color: 'bg-green-100 text-green-600',
  },
  {
    icon: MessageSquare,
    title: 'Networking',
    description: 'Connect directly with alumni through our messaging platform.',
    color: 'bg-purple-100 text-purple-600',
  },
  {
    icon: Heart,
    title: 'Give Back',
    description: 'Support your alma mater through donations and volunteer opportunities.',
    color: 'bg-rose-100 text-rose-600',
  },
  {
    icon: MapPin,
    title: 'Chapters',
    description: 'Join local alumni chapters in your city and participate in regional events.',
    color: 'bg-cyan-100 text-cyan-600',
  },
  {
    icon: BookOpen,
    title: 'Mentorship',
    description: 'Give or receive guidance through our alumni mentorship program.',
    color: 'bg-indigo-100 text-indigo-600',
  },
  {
    icon: Award,
    title: 'Recognition',
    description: 'Celebrate achievements and success stories of our distinguished alumni.',
    color: 'bg-orange-100 text-orange-600',
  },
];

export function FeaturesSection() {
  return (
    <section className="py-20 bg-background">
      <div className="container">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">Everything You Need to Stay Connected</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Our platform offers a comprehensive suite of features designed to help alumni 
            network, grow professionally, and give back to the community.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, index) => (
            <Card key={index} className="border-none shadow-md hover:shadow-lg transition-shadow">
              <CardContent className="p-6">
                <div className={`inline-flex p-3 rounded-xl ${feature.color} mb-4`}>
                  <feature.icon className="h-6 w-6" />
                </div>
                <h3 className="font-semibold text-lg mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
