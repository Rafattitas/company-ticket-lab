BEGIN;
CREATE TABLE IF NOT EXISTS departments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE CHECK (char_length(trim(name)) BETWEEN 2 AND 80),
  active BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO departments(name) VALUES ('IT Support'), ('Infrastructure'), ('Applications') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS sla_policies (
  priority VARCHAR(20) PRIMARY KEY CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  response_hours INTEGER NOT NULL CHECK (response_hours BETWEEN 1 AND 8760),
  resolution_hours INTEGER NOT NULL CHECK (resolution_hours BETWEEN response_hours AND 8760)
);
INSERT INTO sla_policies VALUES ('urgent', 1, 8), ('high', 4, 24), ('normal', 8, 72), ('low', 24, 120) ON CONFLICT DO NOTHING;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS department_id BIGINT REFERENCES departments(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assigned_user_id BIGINT REFERENCES user_accounts(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS response_due_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolution_due_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS tickets_department_index ON tickets(department_id);
CREATE INDEX IF NOT EXISTS tickets_assigned_user_index ON tickets(assigned_user_id);

CREATE OR REPLACE FUNCTION initialize_ticket_sla() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE policy sla_policies%ROWTYPE;
BEGIN
  SELECT * INTO STRICT policy FROM sla_policies WHERE priority = NEW.priority;
  NEW.response_due_at := NEW.created_at + make_interval(hours => policy.response_hours);
  NEW.resolution_due_at := NEW.created_at + make_interval(hours => policy.resolution_hours);
  IF NEW.department_id IS NULL THEN
    SELECT id INTO NEW.department_id FROM departments WHERE name = 'IT Support' AND active;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tickets_initialize_sla ON tickets;
CREATE TRIGGER tickets_initialize_sla BEFORE INSERT ON tickets FOR EACH ROW EXECUTE FUNCTION initialize_ticket_sla();

ALTER TABLE ticket_events DROP CONSTRAINT IF EXISTS ticket_events_kind_check;
ALTER TABLE ticket_events ADD CONSTRAINT ticket_events_kind_check
  CHECK (kind IN ('created', 'status_changed', 'assignment_changed', 'department_changed'));
COMMIT;
