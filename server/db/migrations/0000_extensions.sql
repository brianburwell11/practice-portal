-- `citext` backs the case-insensitive email columns on app_user and invite.
-- `gen_random_uuid()` is core since Postgres 13, so no pgcrypto is needed.
CREATE EXTENSION IF NOT EXISTS citext;
