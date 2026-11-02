/** Every ArrayBuffer inside a value, for a zero-copy postMessage transfer. */
export function findTransferables(value: unknown, found = new Set<ArrayBuffer>()): ArrayBuffer[] {
  if (value instanceof ArrayBuffer) found.add(value);
  else if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer) found.add(value.buffer);
  else if (Array.isArray(value)) value.forEach((v) => findTransferables(v, found));
  else if (value && typeof value === 'object' && !(value instanceof Blob)) {
    Object.values(value).forEach((v) => findTransferables(v, found));
  }
  return [...found];
}
