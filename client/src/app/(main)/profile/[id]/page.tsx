import { Metadata } from 'next';
import { ProfileClient } from './ProfileClient';
import { api } from '@/lib/api';

interface Props {
  params: { id: string };
}

// Fetch profile data on server for SEO
async function getProfile(id: string) {
  try {
    // In a real server component, you'd fetch from your API
    // For now, we simulate or use a server-side axios instance if configured
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/users/${id}`, {
      next: { revalidate: 3600 } // Cache for 1 hour
    });
    const data = await response.json();
    return data.data;
  } catch (error) {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const profile = await getProfile(params.id);
  
  if (!profile) {
    return { title: 'Profile | Alumni Connect' };
  }

  return {
    title: `${profile.fullName} | Alumni Connect`,
    description: profile.headline || `Alumni profile of ${profile.fullName} from ${profile.department} department.`,
    openGraph: {
      title: `${profile.fullName} on Alumni Connect`,
      description: profile.bio || profile.headline,
      images: profile.profilePhotoUrl ? [profile.profilePhotoUrl] : [],
      type: 'profile',
    },
  };
}

export default async function ProfilePage({ params }: Props) {
  const profile = await getProfile(params.id);

  if (!profile) {
    return <div className="text-center py-20">Profile not found.</div>;
  }

  return <ProfileClient profile={profile} id={params.id} />;
}
