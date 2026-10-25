CREATE TABLE apps_staging AS SELECT * FROM apps WHERE 0;
CREATE TABLE chart_ranks_staging AS SELECT * FROM chart_ranks WHERE 0;
CREATE TABLE app_metrics_staging AS SELECT * FROM app_metrics WHERE 0;

UPDATE ingest_runs SET status = 'error', error = 'superseded duplicate run', finished_at = CURRENT_TIMESTAMP
WHERE status = 'running' AND id <> (SELECT MAX(id) FROM ingest_runs WHERE status = 'running');
CREATE UNIQUE INDEX idx_ingest_one_running ON ingest_runs (status) WHERE status = 'running';
