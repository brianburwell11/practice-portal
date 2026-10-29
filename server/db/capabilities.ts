/**
 * The capability catalog and role bundles, defined in src/config so the app
 * can show them too (the Help guide's permissions table). Seeds the
 * `capability`, `role` and `role_capability` tables (scripts/gen-seed-migration.ts).
 */
export * from '../../src/config/capabilities';
