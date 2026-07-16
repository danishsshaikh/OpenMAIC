import { notFound } from 'next/navigation';
import { SpotlightSnapshotEvalClient } from './spotlight-snapshot-client';

export default function SpotlightSnapshotEvalPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return <SpotlightSnapshotEvalClient />;
}
