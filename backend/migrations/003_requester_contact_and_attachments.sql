BEGIN;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS requester_email VARCHAR(254) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS requester_phone VARCHAR(32) NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS ticket_attachments (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
  file_name VARCHAR(180) NOT NULL,
  content_type VARCHAR(40) NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 5242880),
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ticket_attachments_type_allowed
    CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp'))
);

CREATE INDEX IF NOT EXISTS tickets_requester_email_index ON tickets (requester_email);

COMMIT;
