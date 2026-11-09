import { Skeleton } from '../ui/Loading';

/** The mixer's shape, its M/S bar and a row of channel strips, while a song loads. */
export function MixerSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`flex-1 p-4 overflow-hidden md:flex md:flex-col md:justify-end ${className}`} role="status">
      <span className="sr-only">Loading the song</span>
      <div className="flex gap-2 w-full md:w-[230px] mb-3 md:ml-[90px]">
        <Skeleton className="flex-1 h-11 md:h-7" />
        <Skeleton className="flex-1 h-11 md:h-7" />
      </div>
      {/* Desktop: vertical channel strips */}
      <div className="hidden md:flex flex-row gap-1.5 h-[300px]">
        {/* Room for the row-label column */}
        <div className="w-[84px] shrink-0" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex flex-col items-center gap-1 w-[76px] p-1 px-1.5 bg-gray-800 rounded-md">
            <Skeleton className="h-5 w-full" />
            <div className="h-4" />
            <Skeleton className="w-7 h-7 rounded-full" />
            <Skeleton className="flex-1 w-1.5 rounded-full" />
            <Skeleton className="h-3.5 w-8" />
            <div className="flex gap-1 w-full">
              <Skeleton className="flex-1 h-5" />
              <Skeleton className="flex-1 h-5" />
            </div>
          </div>
        ))}
      </div>
      {/* Phones: horizontal cards */}
      <div className="flex flex-col gap-3 md:hidden">
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
