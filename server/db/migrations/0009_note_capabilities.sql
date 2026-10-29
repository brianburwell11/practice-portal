-- Shared song notes: any member may add notes and edit or delete their own;
-- Managers and the Owner may edit or delete anyone's. Notes are no longer
-- part of song.content.write. Mirrors server/db/capabilities.ts (0002 is
-- regenerated from it for fresh databases; this brings existing ones along).
INSERT INTO "capability" ("key", "description") VALUES
  ('note.create', 'Add timestamp notes to songs, and edit or delete your own'),
  ('note.moderate', 'Edit or delete anyone’s notes'),
  ('song.content.write', 'Edit lyrics and song metadata')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";
--> statement-breakpoint
INSERT INTO "role_capability" ("role_key", "capability_key") VALUES
  ('owner', 'note.create'),
  ('owner', 'note.moderate'),
  ('manager', 'note.create'),
  ('manager', 'note.moderate'),
  ('editor', 'note.create'),
  ('member', 'note.create')
ON CONFLICT DO NOTHING;
