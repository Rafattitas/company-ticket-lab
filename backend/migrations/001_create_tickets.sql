BEGIN;

CREATE TABLE IF NOT EXISTS tickets (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT tickets_title_length
    CHECK (char_length(trim(title)) BETWEEN 3 AND 200),

  CONSTRAINT tickets_status_allowed
    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed'))
);

CREATE INDEX IF NOT EXISTS tickets_status_index
  ON tickets (status);

CREATE INDEX IF NOT EXISTS tickets_created_at_index
  ON tickets (created_at DESC);

COMMIT;
