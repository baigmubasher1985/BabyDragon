# infra/ — Foundation scaffolding only (F10C1I Phase 1)

**Status:** Documentation scaffolding. **No deployable workloads.**

First wave remains **managed Supabase + Edge Functions**.  
Kubernetes / containers are **not** the privileged-profile path in F10C1I.

## Product target

Infra notes exist only to support future operable delivery of result-ingestion/QC (F10C2), not unrelated platform expansion.

## Layout

| Path | Purpose |
|------|---------|
| `docker/` | Future container notes — Dockerfile belongs to a **later** container phase |
| `k8s/` | Documentation-only future API notes |

## Forbidden in Phase 1

- Creating a deployable image  
- Creating k8s Deployments/Services that run  
- Embedding `service_role` or other secrets  
- Treating `docker-compose` alone as sufficient (Dockerfile + `.dockerignore` required in the later container phase)  
