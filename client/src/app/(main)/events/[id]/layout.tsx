import type { Metadata } from 'next';

const apiBase = () =>
  (process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api').replace(/\/+$/, '');

const summarize = (text: unknown) => {
  if (typeof text !== 'string') return undefined;
  const plain = text.replace(/\s+/g, ' ').trim();
  return plain.length > 160 ? `${plain.slice(0, 157)}...` : plain || undefined;
};

/** Per-event title/description for search and link previews; falls back quietly if the API is unreachable. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const fallback: Metadata = { title: 'Event | AIEM Connect' };
  try {
    const { id } = await params; // Next 15: route params are a Promise
    const res = await fetch(`${apiBase()}/events/${encodeURIComponent(id)}`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return fallback;
    const body = await res.json();
    const event = body?.data;
    if (!event?.title) return fallback;
    const title = `${event.title} | AIEM Connect Events`;
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
