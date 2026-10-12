create unique index jobs_one_active_per_cv on jobs (cv_id) where status in ('queued', 'running');
