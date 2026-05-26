-- Dedicated application role for RLS enforcement.
-- Tests (and, eventually, runtime connections from core/db/client.ts) use this
-- role so that Postgres actually enforces RLS policies: the default `postgres`
-- superuser is the table owner and bypasses RLS regardless of `row_security`.
-- This role is NOSUPERUSER, NOBYPASSRLS (default) and not the owner of tables.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spaceship_app') THEN
    CREATE ROLE spaceship_app WITH LOGIN PASSWORD 'spaceship_app_dev';
  END IF;
END $$;

GRANT CONNECT ON DATABASE spaceship TO spaceship_app;
GRANT USAGE ON SCHEMA public TO spaceship_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO spaceship_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO spaceship_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO spaceship_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO spaceship_app;
