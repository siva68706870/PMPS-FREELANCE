CREATE OR REPLACE FUNCTION public.has_applied_to_job(_job_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT _user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.applications
    WHERE job_id = _job_id AND freelancer_id = _user_id
  )
$$;
REVOKE ALL ON FUNCTION public.has_applied_to_job(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_applied_to_job(uuid, uuid) TO authenticated;

DROP POLICY "Clients and owners read their additional jobs" ON public.jobs;
CREATE POLICY "Clients, owners, and applicants read their jobs"
ON public.jobs FOR SELECT TO authenticated
USING (
  client_id = auth.uid()
  OR public.has_role(auth.uid(), 'owner')
  OR public.has_applied_to_job(id, auth.uid())
);

DROP POLICY "Users read own, related, and owner-visible profiles" ON public.profiles;
CREATE POLICY "Users read own, related, open-job, and owner-visible profiles"
ON public.profiles FOR SELECT TO authenticated
USING (
  id = auth.uid()
  OR public.has_role(auth.uid(), 'owner')
  OR EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.client_id = profiles.id AND j.status = 'open'
  )
  OR EXISTS (
    SELECT 1 FROM public.applications a JOIN public.jobs j ON j.id = a.job_id
    WHERE (a.freelancer_id = profiles.id AND j.client_id = auth.uid())
       OR (j.client_id = profiles.id AND a.freelancer_id = auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM public.messages m
    WHERE (m.sender_id = auth.uid() AND m.recipient_id = profiles.id)
       OR (m.recipient_id = auth.uid() AND m.sender_id = profiles.id)
  )
);

CREATE OR REPLACE FUNCTION public.prevent_protected_profile_fields_edit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user = 'authenticated'
     AND NOT public.has_role(auth.uid(), 'owner')
     AND NEW.account_state IS DISTINCT FROM OLD.account_state THEN
    RAISE EXCEPTION 'Account status can only be changed by the owner';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_protected_profile_fields_edit() FROM PUBLIC;
CREATE TRIGGER profiles_protect_account_state
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_protected_profile_fields_edit();

CREATE OR REPLACE FUNCTION public.prevent_application_identity_edit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user = 'authenticated'
     AND (NEW.job_id IS DISTINCT FROM OLD.job_id OR NEW.freelancer_id IS DISTINCT FROM OLD.freelancer_id) THEN
    RAISE EXCEPTION 'Application identity cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_application_identity_edit() FROM PUBLIC;
CREATE TRIGGER applications_protect_identity
BEFORE UPDATE ON public.applications
FOR EACH ROW EXECUTE FUNCTION public.prevent_application_identity_edit();