'use client';

import * as React from 'react';
import { landingApi, type LandingBlock } from '@/lib/engagement';
import { LandingBlockView } from './LandingBlockView';

/** Renders the admin-authored landing blocks (published only). Nothing if there are none. */
export function LandingBlocks() {
  const [blocks, setBlocks] = React.useState<LandingBlock[]>([]);

  React.useEffect(() => {
    let active = true;
    landingApi
      .publicBlocks()
      .then((b) => active && setBlocks(b))
      .catch(() => {
        /* landing still works with the built-in sections if this fails */
      });
    return () => {
      active = false;
    };
  }, []);

  if (blocks.length === 0) return null;
  return (
    <>
      {blocks.map((b) => (
        <LandingBlockView key={b.id} block={b} />
      ))}
    </>
  );
}
