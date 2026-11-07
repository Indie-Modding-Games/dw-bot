-- Esquema D1 para Andromon (equivalente a data/feedback.json de la version local).
CREATE TABLE IF NOT EXISTS feedback_records (
  issue_number INTEGER PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
