import { Navigate } from 'react-router-dom';

// Legacy route component. Kept as a thin redirect so any old links/bookmarks
// land on the canonical guest exit page.
export default function ThankYou() {
  return <Navigate to="/room-exit/unknown" replace state={{ exitRole: 'guest' }} />;
}