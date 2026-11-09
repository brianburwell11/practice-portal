/** Circular-arrows icon for a strip's "Reset to defaults" button. */
export function ResetIcon({ className = 'w-2.5 h-2.5' }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2a10 10 0 0 1 8.5 4.7l-2.3-.4a1.2 1.2 0 1 0-.4 2.4l4.6.8a1.2 1.2 0 0 0 1.4-1l.8-4.6a1.2 1.2 0 0 0-2.4-.4l-.3 1.8A12 12 0 0 0 0 12a1.2 1.2 0 0 0 2.4 0A9.6 9.6 0 0 1 12 2ZM12 22a10 10 0 0 1-8.5-4.7l2.3.4a1.2 1.2 0 1 0 .4-2.4l-4.6-.8a1.2 1.2 0 0 0-1.4 1l-.8 4.6a1.2 1.2 0 0 0 2.4.4l.3-1.8A12 12 0 0 0 24 12a1.2 1.2 0 0 0-2.4 0A9.6 9.6 0 0 1 12 22Z" />
    </svg>
  );
}
