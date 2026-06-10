-- 0006_usage_log_church_scoped_idempotency
-- usage_log.idempotency_key shipped as a GLOBAL unique (0001:162), but the key
-- is derived per church — `svc-{serviceId}:item-{serviceItemId}` from ids that
-- are only church-local. Two churches that generate the same service/item id
-- pair collide, and `logUsage`'s `on conflict do nothing` silently swallowed the
-- second church's TONO/CCLI usage event (route returns ok:true, logged:false).
-- That is a hole in the licensing moat. Scope the dedupe to the church.

alter table public.usage_log
  drop constraint if exists usage_log_idempotency_key_key;

alter table public.usage_log
  add constraint usage_log_church_idempotency_key
  unique (church_id, idempotency_key);
