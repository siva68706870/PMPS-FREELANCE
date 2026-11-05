CREATE OR REPLACE FUNCTION public.is_account_active(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND account_state = 'active'
  )
$$;
REVOKE ALL ON FUNCTION public.is_account_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_account_active(uuid) TO anon, authenticated, service_role;

DROP POLICY "Anyone can read active open jobs" ON public.jobs;
CREATE POLICY "Anyone can read active open jobs"
ON public.jobs FOR SELECT TO anon, authenticated
USING (status = 'open' AND public.is_account_active(client_id));

DROP POLICY "Freelancers apply to open jobs once" ON public.applications;
CREATE POLICY "Freelancers apply to open jobs once"
ON public.applications FOR INSERT TO authenticated
WITH CHECK (
  freelancer_id = auth.uid()
  AND public.has_role(auth.uid(), 'freelancer')
  AND public.is_account_active(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id = applications.job_id AND j.status = 'open'
      AND public.is_account_active(j.client_id)
  )
);

DROP POLICY "Application participants and owners send messages" ON public.messages;
CREATE POLICY "Application participants and owners send messages"
ON public.messages FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND public.is_account_active(auth.uid())
  AND (
    public.has_role(auth.uid(), 'owner')
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      JOIN public.applications a ON a.job_id = j.id
      WHERE j.id = messages.job_id AND j.status = 'open'
        AND ((j.client_id = auth.uid() AND a.freelancer_id = messages.recipient_id)
          OR (j.client_id = messages.recipient_id AND a.freelancer_id = auth.uid()))
    )
  )
);

DROP POLICY "Users update own profile and owners manage all profiles" ON public.profiles;
CREATE POLICY "Users update own active profile and owners manage all profiles"
ON public.profiles FOR UPDATE TO authenticated
USING ((id = auth.uid() AND public.is_account_active(auth.uid())) OR public.has_role(auth.uid(), 'owner'))
WITH CHECK ((id = auth.uid() AND public.is_account_active(auth.uid())) OR public.has_role(auth.uid(), 'owner'));

DROP POLICY "Members report another account" ON public.reports;
CREATE POLICY "Active members report another account"
ON public.reports FOR INSERT TO authenticated
WITH CHECK (
  reporter_id = auth.uid() AND public.is_account_active(auth.uid())
  AND target_id IS NOT NULL AND target_id <> auth.uid()
);

CREATE OR REPLACE FUNCTION public.handle_new_pmps_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  assigned_role public.pmps_role;
  role_is_selected boolean;
  name_value text;
BEGIN
  IF lower(COALESCE(NEW.email, '')) = 'sivashanmugam51015@gmail.com'
     AND NEW.email_confirmed_at IS NOT NULL THEN
    assigned_role := 'owner';
    role_is_selected := true;
  ELSIF NEW.raw_user_meta_data ->> 'role' IN ('client', 'freelancer') THEN
    assigned_role := (NEW.raw_user_meta_data ->> 'role')::public.pmps_role;
    role_is_selected := true;
  ELSE
    assigned_role := 'freelancer';
    role_is_selected := false;
  END IF;
  name_value := left(COALESCE(NEW.raw_user_meta_data ->> 'display_name',
    NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name',
    split_part(COALESCE(NEW.email, 'Member'), '@', 1), 'Member'), 120);
  INSERT INTO public.profiles (id, display_name, role_selected)
  VALUES (NEW.id, COALESCE(NULLIF(name_value, ''), 'Member'), role_is_selected)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, assigned_role)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_verified_pmps_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF lower(COALESCE(NEW.email, '')) = 'sivashanmugam51015@gmail.com'
     AND NEW.email_confirmed_at IS NOT NULL
     AND (OLD.email_confirmed_at IS DISTINCT FROM NEW.email_confirmed_at OR OLD.email IS DISTINCT FROM NEW.email) THEN
    INSERT INTO public.profiles (id, display_name, role_selected)
    VALUES (NEW.id, left(COALESCE(NEW.raw_user_meta_data ->> 'display_name', NEW.raw_user_meta_data ->> 'full_name', 'Owner'), 120), true)
    ON CONFLICT (id) DO UPDATE SET role_selected = true;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'owner')
    ON CONFLICT (user_id) DO UPDATE SET role = 'owner';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.promote_verified_pmps_owner() FROM PUBLIC;
CREATE TRIGGER on_auth_user_verified_pmps_owner
AFTER UPDATE OF email_confirmed_at, email ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.promote_verified_pmps_owner();