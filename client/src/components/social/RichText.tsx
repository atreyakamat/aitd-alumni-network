'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { tokenizeContent, type MentionRef } from '@/lib/social';

/** Post/comment text with #hashtags, @mentions and URLs as links. Rendered as React nodes, never HTML. */
export function RichText({
  text,
  mentions = [],
  className,
}: {
  text: string;
  mentions?: MentionRef[];
  className?: string;
}) {
  const tokens = useMemo(() => tokenizeContent(text, mentions), [text, mentions]);
  if (!text) return null;
  return (
    <p className={cn('whitespace-pre-wrap break-words text-sm leading-relaxed', className)}>
      {tokens.map((token, i) => {
        switch (token.kind) {
          case 'hashtag':
            return (
              <Link key={i} href={token.href} className="font-medium text-primary hover:underline">
                {token.value}
              </Link>
            );
          case 'mention':
            return (
              <Link key={i} href={token.href} className="font-medium text-primary hover:underline">
                {token.value}
              </Link>
            );
          case 'url':
            return (
              <a key={i} href={token.href} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-primary underline-offset-2 hover:underline break-all">
                {token.value}
              </a>
            );
          default:
            return <span key={i}>{token.value}</span>;
        }
      })}
    </p>
  );
}
