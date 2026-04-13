/**
 * Per-stem peak computation for the alignment canvas.
 *
 * Returns a Float32Array of interleaved [min, max, min, max, ...] — one pair
 * per bucket. Mirrors the algorithm in AudioEngine.computeMergedPeaks but
 * scoped to a single buffer (no cross-stem merging).
 */
export function computePeaks(buffer: AudioBuffer, bucketCount = 2048): Float32Array {
  const peaks = new Float32Array(bucketCount * 2);
  const length = buffer.length;
  if (length === 0) return peaks;

  const channels = buffer.numberOfChannels;
  const samplesPerBucket = length / bucketCount;

  for (let b = 0; b < bucketCount; b++) {
    let bucketMin = 0;
    let bucketMax = 0;
    const start = Math.floor(b * samplesPerBucket);
    const end = Math.min(Math.floor((b + 1) * samplesPerBucket), length);

    for (let ch = 0; ch < channels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let s = start; s < end; s++) {
        const val = data[s] / channels; // average across channels
        if (val < bucketMin) bucketMin = val;
        if (val > bucketMax) bucketMax = val;
      }
    }

    peaks[b * 2] = bucketMin;
    peaks[b * 2 + 1] = bucketMax;
  }

  return peaks;
}
