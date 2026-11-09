import * as Slider from '@radix-ui/react-slider';
import { formatDb } from '../../audio/db';

/** Top of the fader, as linear gain (+3.5 dB). */
export const MAX_GAIN = 1.5;

/** Scale marks, in dB. -∞ is the bottom of the travel. */
const TICKS: { db: number; label: string }[] = [
  { db: 3, label: '+3' },
  { db: 0, label: '0' },
  { db: -3, label: '-3' },
  { db: -6, label: '-6' },
  { db: -10, label: '-10' },
  { db: -Infinity, label: '-∞' },
];

/** Where `db` sits on the fader, 0 (bottom) to 1 (top). The travel is linear in gain. */
const position = (db: number) => (db === -Infinity ? 0 : 10 ** (db / 20) / MAX_GAIN);

/** Unlabelled marks at every whole dB between the labelled ones (+3 to -20). */
const MAJOR = new Set(TICKS.map((t) => t.db));
const SUBTICKS = Array.from({ length: 24 }, (_, i) => 3 - i).filter((db) => !MAJOR.has(db));

interface VerticalFaderProps {
  value: number;
  onChange: (value: number) => void;
  /** Double-click target, usually the stem's default volume. */
  resetValue: number;
  color: string;
  label: string;
}

/**
 * The fader's dB marks: labelled ones plus a tick at every whole dB between.
 * Inset by half the cap's height (h-4), the way Radix keeps the cap inside
 * the track, so each mark lines up with the cap's center. Used beside each
 * fader and in the mixer's row-label column.
 */
export function FaderScale({ className = 'w-6' }: { className?: string }) {
  return (
    <div aria-hidden className={`relative h-full py-2 ${className}`}>
      <div className="relative h-full">
        {SUBTICKS.map((db) => (
          <span
            key={db}
            className="absolute right-0 block w-0.5 h-px bg-gray-500 translate-y-1/2"
            style={{ bottom: `${position(db) * 100}%` }}
          />
        ))}
        {TICKS.map(({ db, label: text }) => (
          <div
            key={text}
            className="absolute right-0 flex items-center gap-0.5 translate-y-1/2"
            style={{ bottom: `${position(db) * 100}%` }}
          >
            <span className={`text-[8px] leading-none font-mono ${db === 0 ? 'text-gray-300' : 'text-gray-500'}`}>
              {text}
            </span>
            <span className={`block h-px ${db === 0 ? 'w-1.5 bg-gray-300' : 'w-1 bg-gray-500'}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Logic-style vertical volume fader (desktop) with a dB scale on its left.
 * Same 0 to 1.5 linear gain range as the phone slider.
 */
export function VerticalFader({ value, onChange, resetValue, color, label }: VerticalFaderProps) {
  return (
    <div className="flex h-full min-h-[100px] gap-0.5">
      <FaderScale />

      <Slider.Root
        orientation="vertical"
        min={0}
        max={MAX_GAIN}
        step={0.01}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        onDoubleClick={() => onChange(resetValue)}
        className="relative flex flex-col items-center select-none touch-none w-7 h-full"
        title="Double-click to reset"
      >
        <Slider.Track className="relative grow w-1.5 rounded-full bg-gray-900">
          <Slider.Range className="absolute w-full rounded-full" style={{ backgroundColor: color }} />
        </Slider.Track>
        {/* The label goes on the thumb, the element with role="slider";
            on Root it would name a wrapper, leaving the slider unnamed. */}
        <Slider.Thumb
          aria-label={label}
          aria-valuetext={`${formatDb(value)} dB`}
          className="block w-7 h-4 rounded-sm bg-gradient-to-b from-gray-200 to-gray-400 shadow-md border border-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <span aria-hidden className="block mx-1 mt-[7px] h-px bg-gray-600" />
        </Slider.Thumb>
      </Slider.Root>
    </div>
  );
}
