-- UI preferences that must survive clearing the browser: e.g. the Candidates columns (order and visibility, autosaved)
-- and your named views. One JSON value per key; the app never reads them for scoring or scans.
CREATE TABLE ui_settings (
    key        text PRIMARY KEY,
    value      jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
