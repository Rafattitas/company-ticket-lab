BEGIN;

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tracking_token_hash VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS tickets_tracking_token_index
  ON tickets (tracking_token_hash) WHERE tracking_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS ticket_comments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_kind VARCHAR(12) NOT NULL CHECK (author_kind IN ('employee', 'staff')),
  author_name VARCHAR(120) NOT NULL,
  actor_id BIGINT REFERENCES user_accounts(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 5000),
  internal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (author_kind = 'staff' OR internal = FALSE)
);
CREATE INDEX IF NOT EXISTS ticket_comments_ticket_index ON ticket_comments(ticket_id, id DESC);

CREATE TABLE IF NOT EXISTS ticket_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  kind VARCHAR(24) NOT NULL CHECK (kind IN ('created', 'status_changed', 'assignment_changed')),
  actor_name VARCHAR(120) NOT NULL,
  actor_id BIGINT REFERENCES user_accounts(id) ON DELETE SET NULL,
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ticket_events_ticket_index ON ticket_events(ticket_id, id DESC);

COMMIT;
