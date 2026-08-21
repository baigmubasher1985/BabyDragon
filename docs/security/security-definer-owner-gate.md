# SECURITY DEFINER Owner Gate (Unresolved)

**Status:** **UNRESOLVED** — `BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION`  
**Step:** F10C1I Phase 2

## Decision required

Future SECURITY DEFINER helpers/RPCs must use a **controlled non-login** owner (not invented here).

Today’s captured owner for known functions is login role `postgres` (from `01a_function_summary.csv`). Replacing DEFINER objects without an agreed non-login owner is a **stop condition**.

## Rules

- Do **not** hard-code a guessed role name in draft SQL.  
- Do **not** `CREATE ROLE` in Phase 2 drafts.  
- Do **not** apply DEFINER replacements while this gate is open.  
- Drafts 002–007 mark `-- OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION`.  
- Record the chosen owner **name only** (no passwords) in offline operator notes after disposable proof.  

## Related

- Fail closed: `p.is_active IS TRUE`  
- Empty / non-writable `search_path` with fully qualified names  
- REVOKE `PUBLIC` / `anon` EXECUTE as designed (draft 008)  
