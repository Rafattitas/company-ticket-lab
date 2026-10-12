BEGIN;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS category VARCHAR(80) NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS requester_name VARCHAR(120) NOT NULL DEFAULT 'Legacy requester',
  ADD COLUMN IF NOT EXISTS assigned_to VARCHAR(120) NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tickets_priority_allowed'
  ) THEN
    ALTER TABLE tickets
      ADD CONSTRAINT tickets_priority_allowed
      CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS tickets_priority_index ON tickets (priority);
CREATE INDEX IF NOT EXISTS tickets_requester_name_index ON tickets (requester_name);

COMMIT;
