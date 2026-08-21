# infra/k8s/ — Documentation-only scaffolding

**Phase 1:** README only. No Deployments, Services, Secrets, or Helm charts that run.

Future K8s API (if any) must follow the same rules as Edge:

- Verify caller JWT before privileged actions  
- Application role authorization with fail-closed `is_active IS TRUE`  
- `service_role` only in server-side secrets  
- No expansion into a generic multi-tenant platform in this step  

F10C1I does **not** authorize k8s workloads. Privileged profile path remains Edge Functions for the first remediation wave.
