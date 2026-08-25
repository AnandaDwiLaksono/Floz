CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code varchar(32) NOT NULL UNIQUE,
  name varchar(64) NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO roles (code, name, description)
VALUES
  ('ADMIN', 'Admin', 'Workspace administrator'),
  ('MANAGER', 'Manager', 'Workspace manager'),
  ('MEMBER', 'Member', 'Workspace member'),
  ('FIELD_WORKER', 'Field Worker', 'Field worker')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;
