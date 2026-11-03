import { Skeleton } from '../ui/Loading';

/** The mixer's shape, its M/S bar and a row of channel strips, while a song loads. */
export function MixerSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`flex-1 p-4 overflow-hidden ${className}`} role="status">
      <span className="sr-only">Loading the song</span>
      <div className="flex gap-2 w-full md:w-[230px] mb-3">
        <Skeleton className="flex-1 h-11 md:h-7" />
        <Skeleton className="flex-1 h-11 md:h-7" />
      </div>
      <div className="flex flex-col md:flex-row gap-3 md:flex-wrap md:items-start">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex flex-col gap-3 p-3 bg-gray-800 rounded-lg min-w-[230px]">
            <div className="flex items-center gap-2">
              <Skeleton className="w-3 h-3 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-7" />
              <Skeleton className="flex-1 h-2 rounded-full" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-7" />
              <Skeleton className="flex-1 h-2 rounded-full" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="flex-1 h-11 md:h-6" />
              <Skeleton className="flex-1 h-11 md:h-6" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
