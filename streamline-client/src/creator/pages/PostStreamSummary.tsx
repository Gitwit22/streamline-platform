import { Navigate, useSearchParams } from 'react-router-dom';

// Legacy route component. Kept as a thin redirect so any old links/bookmarks
// land on the canonical post-stream exit page.
export default function PostStreamSummary() {
  const [sp] = useSearchParams();
  const recordingId = (sp.get('recordingId') || '').trim();
  const target = recordingId ? `/room-exit/${encodeURIComponent(recordingId)}` : '/room-exit/unknown';
  return <Navigate to={target} replace state={{ exitRole: 'host' }} />;
}
