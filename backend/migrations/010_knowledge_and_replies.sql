BEGIN;
CREATE TABLE IF NOT EXISTS reply_templates (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 title VARCHAR(120) NOT NULL CHECK (char_length(trim(title)) BETWEEN 2 AND 120),
 body TEXT NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 5000),
 active BOOLEAN NOT NULL DEFAULT TRUE,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS knowledge_articles (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 title VARCHAR(200) NOT NULL CHECK (char_length(trim(title)) BETWEEN 3 AND 200),
 category VARCHAR(80) NOT NULL DEFAULT 'General',
 body TEXT NOT NULL CHECK (char_length(trim(body)) BETWEEN 10 AND 20000),
 published BOOLEAN NOT NULL DEFAULT FALSE,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS knowledge_public_index ON knowledge_articles(published,updated_at DESC,id DESC);
INSERT INTO reply_templates(title,body,active)
SELECT seed.title,seed.body,TRUE FROM (VALUES
 ('Request received','We have received your request and are reviewing it. We will update this ticket when we have more information.'),
 ('More information needed','Could you share the exact error message, when the issue started, and the steps you have already tried? Please do not send passwords or other sensitive information.')
) AS seed(title,body) WHERE NOT EXISTS (SELECT 1 FROM reply_templates WHERE title=seed.title);
COMMIT;
