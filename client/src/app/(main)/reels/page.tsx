'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ReelsViewer } from '@/components/social/ReelsViewer';

function ReelsWithStart() {
  const params = useSearchParams();
  return <ReelsViewer startId={params?.get('start')} />;
}

export default function ReelsPage() {
  return (
    <Suspense fallback={null}>
      <ReelsWithStart />
    </Suspense>
  );
}
