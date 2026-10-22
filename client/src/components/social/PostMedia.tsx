'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Volume2, VolumeX } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { mediaSrc } from '@/lib/social';
import { cn } from '@/lib/utils';

/** `video.play()` returns a promise in modern browsers and nothing in older ones; never let it throw. */
export function safePlay(video: HTMLVideoElement, onBlocked?: () => void): void {
  try {
    const result = video.play() as Promise<void> | undefined;
    if (result && typeof result.catch === 'function') result.catch(() => onBlocked?.());
  } catch {
    onBlocked?.();
  }
}

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Muted video that plays while at least `threshold` of it is on screen and pauses otherwise.
 * With reduced motion it never autoplays; the native controls stay available.
 */
export function AutoplayVideo({
  src,
  poster,
  className,
  threshold = 0.6,
  label = 'Post video',
  loop = true,
  controls = true,
  onVisible,
}: {
  src: string;
  poster?: string | null;
  className?: string;
  threshold?: number;
  label?: string;
  loop?: boolean;
  controls?: boolean;
  onVisible?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const video = ref.current;
    if (!video || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= threshold) {
          onVisible?.();
          if (!prefersReducedMotion()) safePlay(video);
        } else {
          video.pause();
        }
      },
      { threshold: [0, threshold, 1] }
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [threshold, onVisible]);

  return (
    <div className={cn('relative overflow-hidden rounded-lg bg-black', className)}>
      <video
        ref={ref}
        src={mediaSrc(src)}
        poster={poster ? mediaSrc(poster) : undefined}
        muted={muted}
        loop={loop}
        playsInline
        preload="metadata"
        controls={controls}
        aria-label={label}
        className="h-full max-h-[70vh] w-full object-contain"
      />
      <button
        type="button"
        onClick={() => setMuted((m) => !m)}
        aria-label={muted ? 'Unmute video' : 'Mute video'}
        className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
      >
        {muted ? <VolumeX className="h-4 w-4" aria-hidden="true" /> : <Volume2 className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  );
}

/** 1–4 images in a grid ("+N" on the fourth when there are more), opening a lightbox. */
export function ImageGrid({ urls, alt = 'Post image' }: { urls: string[]; alt?: string }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (urls.length === 0) return null;
  const shown = urls.slice(0, 4);
  const extra = urls.length - shown.length;

  return (
    <>
      <div
        className={cn(
          'grid gap-1 overflow-hidden rounded-lg',
          shown.length === 1 ? 'grid-cols-1' : 'grid-cols-2',
          shown.length === 3 && '[&>*:first-child]:row-span-2'
        )}
      >
        {shown.map((url, i) => (
          <button
            key={`${url}-${i}`}
            type="button"
            onClick={() => setOpenIndex(i)}
            aria-label={`Open image ${i + 1} of ${urls.length}`}
            className={cn('relative block overflow-hidden bg-muted', shown.length === 1 ? 'max-h-[520px]' : 'aspect-square')}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- user uploads from the API origin */}
            <img src={mediaSrc(url)} alt={`${alt} ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />
            {i === 3 && extra > 0 && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-2xl font-semibold text-white">+{extra}</span>
            )}
          </button>
        ))}
      </div>
      <Lightbox urls={urls} index={openIndex} onIndexChange={setOpenIndex} alt={alt} />
    </>
  );
}

function Lightbox({ urls, index, onIndexChange, alt }: { urls: string[]; index: number | null; onIndexChange: (i: number | null) => void; alt: string }) {
  const open = index !== null;
  const go = (delta: number) => {
    if (index === null) return;
    onIndexChange((index + delta + urls.length) % urls.length);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onIndexChange(null)}>
      <DialogContent
        className="max-w-4xl border-0 bg-black/95 p-2 sm:p-4"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') go(1);
          if (e.key === 'ArrowLeft') go(-1);
        }}
      >
        <DialogTitle className="sr-only">Image viewer</DialogTitle>
        <DialogDescription className="sr-only">
          Image {(index ?? 0) + 1} of {urls.length}. Use the arrow keys to move between images.
        </DialogDescription>
        {index !== null && (
          <div className="relative flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- user uploads from the API origin */}
            <img src={mediaSrc(urls.at(index))} alt={`${alt} ${index + 1}`} className="max-h-[80vh] w-auto object-contain" />
            {urls.length > 1 && (
              <>
                <button type="button" onClick={() => go(-1)} aria-label="Previous image" className="absolute left-1 rounded-full bg-white/20 p-2 text-white hover:bg-white/40">
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => go(1)} aria-label="Next image" className="absolute right-1 rounded-full bg-white/20 p-2 text-white hover:bg-white/40">
                  <ChevronRight className="h-5 w-5" aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
