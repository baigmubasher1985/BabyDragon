# infra/docker/ — Later container phase (not now)

**Phase 1:** documentation only.

A future container phase should add:

- `Dockerfile` (app image)  
- `.dockerignore`  
- Optional local compose pointing at a **disposable** URL (no secrets in repo)  

`docker-compose` alone is **insufficient**. Do not create a deployable image in F10C1I Phase 1.

No production env files. No `service_role` in client images.
