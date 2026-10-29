import { Link } from 'react-router-dom';
import practicePortalMark from '../assets/practice-portal-mark-large.png';

/** Any address no route matches. */
export function NotFound() {
  return (
    <div className="min-h-screen bg-page text-gray-100 flex flex-col items-center justify-center p-8 text-center">
      <img src={practicePortalMark} alt="" className="h-16 w-auto mb-6" />
      <h1 className="text-2xl font-semibold mb-2">Page not found</h1>
      <p className="text-gray-400 mb-8 max-w-sm">There’s nothing at this address. Check the link, or start from the home page.</p>
      <Link to="/" className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white">
        Go to Practice Portal
      </Link>
    </div>
  );
}
