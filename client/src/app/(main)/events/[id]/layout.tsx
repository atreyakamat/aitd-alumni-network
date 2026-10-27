import type { Metadata } from 'next';

const apiBase = () =>
  (process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api').replace(/\/+$/, '');

const summarize = (text: unknown) => {
  if (typeof text !== 'string') return undefined;
  const plain = text.replace(/\s+/g, ' ').trim();
  return plain.length > 160 ? `${plain.slice(0, 157)}...` : plain || undefined;
};

/** Per-event title/description for search and link previews; falls back quietly if the API is unreachable. */
export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const fallback: Metadata = { title: 'Event | AIEM Connection' };
  try {
    const res = await fetch(`${apiBase()}/events/${encodeURIComponent(params.id)}`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return fallback;
    const body = await res.json();
    const event = body?.data;
    if (!event?.title) return fallback;
    const title = `${event.title} | AIEM Connection Events`;
    const description = summarize(event.description);
    const image = event.bannerUrl || event.coverImageUrl;
    return {
      title,
      description,
      openGraph: { title, description, type: 'website', ...(image ? { images: [image] } : {}) },
    };
  } catch {
    return fallback;
  }
}

export default function EventDetailLayout({ children }: { children: React.ReactNode }) {
  return children;
}
