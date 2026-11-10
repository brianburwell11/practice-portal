import type { z } from 'zod';
import type { chordEventSchema, chordsDataSchema } from '../config/schema';

export type ChordEvent = z.infer<typeof chordEventSchema>;
export type ChordsData = z.infer<typeof chordsDataSchema>;
