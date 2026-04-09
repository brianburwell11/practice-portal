import * as Slider from '@radix-ui/react-slider';

interface TouchSliderProps {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  onDoubleClick?: () => void;
  label?: string;
  className?: string;
  accentColor?: string;
}

export function TouchSlider({
  min,
  max,
  step,
  value,
  onChange,
  onDoubleClick,
  label,
  className = '',
  accentColor = '#3b82f6',
}: TouchSliderProps) {
  return (
    <Slider.Root
      className={`relative flex items-center select-none touch-none h-5 md:h-4 ${className}`}
      min={min}
      max={max}
      step={step}
      value={[value]}
      onValueChange={([v]) => onChange(v)}
      onDoubleClick={onDoubleClick}
      aria-label={label}
    >
      <Slider.Track className="relative grow rounded-full h-2 md:h-1.5 bg-gray-600">
        <Slider.Range
          className="absolute rounded-full h-full"
          style={{ backgroundColor: accentColor }}
        />
      </Slider.Track>
      <Slider.Thumb
        className="block w-5 h-5 md:w-4 md:h-4 rounded-full bg-white shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </Slider.Root>
  );
}
