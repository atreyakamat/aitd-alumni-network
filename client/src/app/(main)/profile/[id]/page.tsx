import { Metadata } from 'next';
import { ProfileClient } from './ProfileClient';

interface Props {
  params: { id: string };
}

const apiBase = () =>
  (process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api').replace(/\/+$/, '');

// Fetch profile data on server for SEO / initial render
async function getProfile(id: string) {
  if (!id) return null;
  try {
    const response = await fetch(`${apiBase()}/users/${encodeURIComponent(id)}`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.data ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const fallback: Metadata = { title: 'Profile | AITD Connection' };
  const profile = await getProfile(params.id);
  
  if (!profile || !profile.fullName) {
    return fallback;
  }

  const title = `${profile.fullName} | AITD Connection`;
  const description =
    profile.headline ||
    (profile.department ? `Alumni profile of ${profile.fullName} from ${profile.department} department.` : undefined);

  return {
    title,
    description,
    openGraph: {
      title: `${profile.fullName} on AITD Connection`,
      description: profile.bio || description,
      images: profile.profilePhotoUrl ? [profile.profilePhotoUrl] : [],
      type: 'profile',
    },
  };
}

export default async function ProfilePage({ params }: Props) {
  const profile = await getProfile(params.id);
  return <ProfileClient profile={profile} id={params.id} />;
}

