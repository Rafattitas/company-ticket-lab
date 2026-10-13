BEGIN;
CREATE TABLE IF NOT EXISTS email_notifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL UNIQUE,
  recipient VARCHAR(254) NOT NULL,
  kind VARCHAR(24) NOT NULL,
  ticket_status VARCHAR(20) NOT NULL,
  state VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','sent','failed','expired')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMPTZ,
  error_code VARCHAR(40)
);
CREATE INDEX IF NOT EXISTS email_notifications_ready ON email_notifications(state, available_at);

-- Outbox writes commit with the original change, even if the mail worker is down.
-- No content, internal notes, staff identities, or private link tokens enter email.
CREATE OR REPLACE FUNCTION enqueue_ticket_notification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'ticket_comments' THEN
    IF NEW.internal OR NEW.author_kind <> 'staff' THEN RETURN NEW; END IF;
  ELSE
    IF NEW.kind = 'created' THEN RETURN NEW; END IF;
  END IF;
  INSERT INTO email_notifications(ticket_id, source_key, recipient, kind, ticket_status)
  SELECT id, TG_TABLE_NAME || ':' || NEW.id, requester_email,
    CASE WHEN TG_TABLE_NAME = 'ticket_comments' THEN 'public_reply' ELSE to_jsonb(NEW)->>'kind' END,
    status FROM tickets WHERE id = NEW.ticket_id AND requester_email <> '';
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ticket_event_email ON ticket_events;
CREATE TRIGGER ticket_event_email AFTER INSERT ON ticket_events FOR EACH ROW EXECUTE FUNCTION enqueue_ticket_notification();
DROP TRIGGER IF EXISTS ticket_reply_email ON ticket_comments;
CREATE TRIGGER ticket_reply_email AFTER INSERT ON ticket_comments FOR EACH ROW EXECUTE FUNCTION enqueue_ticket_notification();
COMMIT;
