const ID_LENGTH = 8;

export function generateBandId(): string {
  // Base36 gives [0-9a-z]. slice(2) drops the "0." prefix.
  let out = '';
  while (out.length < ID_LENGTH) {
    out += Math.random().toString(36).slice(2);
  }
  return out.slice(0, ID_LENGTH);
}

export function generateUniqueBandId(existingIds: Set<string>): string {
  for (let i = 0; i < 16; i++) {
    const candidate = generateBandId();
    if (!existingIds.has(candidate)) return candidate;
  }
  // Astronomically unlikely — fall through and let the API's dup check catch it.
  return generateBandId();
}
