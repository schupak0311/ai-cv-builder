# Lessons

- The brief is a product spec. Treat its evaluation list as acceptance criteria. Do not frame plans, briefs, the README or commits around a candidate, an interview or a job application.
- Take the simplest reading of a scope decision. "English only" means English Sources and English CVs, with no translation and no cross-language fact check. Record edge cases as README simplifications instead of building for them.
- Point `DATABASE_URL` only at a database your own worktree started. The test setup drops and recreates the schema, so a run against another worktree's database wipes its data mid-run.
- Give a group of related inputs one submit. When an action needs a step the app can do itself, such as saving unsaved edits, do it as part of the action instead of disabling the control behind a "do this first" note.
- Verify against the real model on a cheaper model (`CV_MODEL=claude-sonnet-5-5`). There is no fake model mode. Unit tests inject scripted stubs so the suite needs no key.
