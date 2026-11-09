-- This admin-only RPC verifies a full batch in one transaction.
alter function public.bulk_verify_skd_batch(uuid, text)
  set statement_timeout = '45s';

notify pgrst, 'reload schema';
