import { defineConfig } from 'vitest/config';

/**
 * Unit tests. Separate from vite.config.ts on purpose: that one loads the
 * API plugin, which starts the job worker and connects to the database.
 * Tests touch neither. `happy-dom` provides DOMParser for the MusicXML code.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    // Server tests start with `// @vitest-environment node`.
    environment: 'happy-dom',
  },
});
