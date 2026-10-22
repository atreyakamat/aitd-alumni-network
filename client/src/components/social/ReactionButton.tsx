'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronUp, ThumbsUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { REACTIONS, REACTION_TYPES, compactCount, type ReactionSummary, type ReactionType } from '@/lib/social';

const HOVER_OPEN_MS = 450;
const LONG_PRESS_MS = 500;

/**
 * Click = Like toggle (or remove the current reaction). Hover, long-press, or the chevron
 * button opens a picker with the six reactions. The picker is a keyboard toolbar:
 * ←/→ move, Enter picks, Escape closes.
 */
export function ReactionButton({
  reaction,
  onReact,
  disabled,
  size = 'md',
  label = 'post',
}: {
  reaction: ReactionType | null;
  /** Called with the reaction the user clicked (the caller applies the toggle rule). */
  onReact: (type: ReactionType) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const meta = reaction ? REACTIONS[reaction] : null;
  const Icon = meta?.icon ?? ThumbsUp;

  const clearTimers = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    hoverTimer.current = null;
    pressTimer.current = null;
  };

  useEffect(() => clearTimers, []);

  useEffect(() => {
    if (!open) return;
    const first = pickerRef.current?.querySelector<HTMLButtonElement>('button');
    first?.focus();
    const onDocPointer = (e: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointer);
    return () => document.removeEventListener('pointerdown', onDocPointer);
  }, [open]);

  const pick = (type: ReactionType) => {
    setOpen(false);
    onReact(type);
  };

  const onPickerKey = (e: React.KeyboardEvent) => {
    const buttons = Array.from(pickerRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = (index + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      buttons.at(next)?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      wrapperRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }
  };

  return (
    <div
      ref={wrapperRef}
      className="relative flex items-center"
      onMouseEnter={() => {
        if (disabled) return;
        hoverTimer.current = window.setTimeout(() => setOpen(true), HOVER_OPEN_MS);
      }}
      onMouseLeave={() => {
        clearTimers();
      }}
    >
      <button
        type="button"
        disabled={disabled}
        aria-pressed={reaction !== null}
        aria-label={reaction ? `Remove ${REACTIONS[reaction].label} reaction from this ${label}` : `Like this ${label}`}
        className={cn(
          'flex items-center gap-1.5 rounded-md font-medium transition-colors hover:bg-muted disabled:opacity-50',
          size === 'sm' ? 'px-1.5 py-1 text-xs' : 'px-3 py-2 text-sm',
          meta ? meta.colorClass : 'text-muted-foreground'
        )}
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          clearTimers();
          onReact(reaction ?? 'LIKE');
        }}
        onTouchStart={() => {
          longPressed.current = false;
          pressTimer.current = window.setTimeout(() => {
            longPressed.current = true;
            setOpen(true);
          }, LONG_PRESS_MS);
        }}
        onTouchEnd={() => {
          if (pressTimer.current) window.clearTimeout(pressTimer.current);
        }}
      >
        <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" />
        <span>{meta ? meta.label : 'Like'}</span>
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-label="Choose a reaction"
        aria-haspopup="true"
        aria-expanded={open}
        className={cn('rounded-md text-muted-foreground hover:bg-muted', size === 'sm' ? 'p-0.5' : 'p-1')}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronUp className="h-3 w-3" aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={pickerRef}
          role="toolbar"
          aria-label="Reactions"
          onKeyDown={onPickerKey}
          className="absolute bottom-full left-0 z-30 mb-2 flex gap-1 rounded-full border bg-popover p-1.5 shadow-lg motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95"
        >
          {REACTION_TYPES.map((type) => {
            const r = REACTIONS[type];
            const RIcon = r.icon;
            return (
              <button
                key={type}
                type="button"
                aria-label={r.label}
                title={r.label}
                aria-pressed={reaction === type}
                onClick={() => pick(type)}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full transition-transform hover:scale-125 focus:scale-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transform-none',
                  r.bgClass,
                  r.colorClass,
                  reaction === type && 'ring-2 ring-offset-1 ring-current'
                )}
              >
                <RIcon className="h-5 w-5" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Overlapping icons of the top reactions plus the total; clickable to see who reacted. */
export function ReactionSummaryBadge({
  topReactions,
  total,
  onClick,
  summary,
}: {
  topReactions: ReactionType[];
  total: number;
  summary?: ReactionSummary;
  onClick?: () => void;
}) {
  if (total <= 0) return null;
  const description = topReactions.map((t) => `${summary?.[t] ?? ''} ${REACTIONS[t].label}`.trim()).join(', ');
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary hover:underline"
      aria-label={`${total} reactions${description ? `: ${description}` : ''}. Show who reacted`}
    >
      <span className="flex -space-x-1" aria-hidden="true">
        {(topReactions.length ? topReactions : (['LIKE'] as ReactionType[])).map((t) => {
          const r = REACTIONS[t];
          const RIcon = r.icon;
          return (
            <span key={t} className={cn('flex h-5 w-5 items-center justify-center rounded-full border-2 border-background', r.bgClass, r.colorClass)}>
              <RIcon className="h-3 w-3" />
            </span>
          );
        })}
      </span>
      <span>{compactCount(total)}</span>
    </button>
  );
}
