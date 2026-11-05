CREATE TYPE public.pmps_role AS ENUM ('client', 'freelancer', 'owner');
CREATE TYPE public.application_status AS ENUM ('pending', 'shortlisted', 'selected', 'rejected');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT 'Member' CHECK (char_length(display_name) <= 120),
  avatar_url text,
  headline text CHECK (char_length(headline) <= 160),
  bio text CHECK (char_length(bio) <= 3000),
  location text CHECK (char_length(location) <= 120),
  skills text[] NOT NULL DEFAULT '{}',
  portfolio_url text CHECK (char_length(portfolio_url) <= 500),
  website_url text CHECK (char_length(website_url) <= 500),
  company_name text CHECK (char_length(company_name) <= 160),
  hourly_rate numeric(12,2) CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
  account_state text NOT NULL DEFAULT 'active' CHECK (account_state IN ('active', 'suspended')),
  role_selected boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  role public.pmps_role NOT NULL
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 160),
  category text NOT NULL CHECK (char_length(btrim(category)) BETWEEN 2 AND 80),
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 20 AND 5000),
  budget_min numeric(12,2) CHECK (budget_min IS NULL OR budget_min >= 0),
  budget_max numeric(12,2) CHECK (budget_max IS NULL OR budget_max >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (budget_min IS NULL OR budget_max IS NULL OR budget_max >= budget_min)
);
GRANT SELECT ON public.jobs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobs TO authenticated;
GRANT ALL ON public.jobs TO service_role;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  freelancer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status public.application_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, freelancer_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.applications TO authenticated;
GRANT ALL ON public.applications TO service_role;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sender_id <> recipient_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (char_length(btrim(category)) BETWEEN 2 AND 80),
  details text NOT NULL CHECK (char_length(btrim(details)) BETWEEN 10 AND 3000),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.pmps_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN _user_id IS DISTINCT FROM auth.uid() THEN false
    ELSE EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) END
$$;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.pmps_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.pmps_role) TO authenticated, service_role;

CREATE POLICY "Members read their own role and owners read all roles"
ON public.user_roles FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'owner'));

CREATE POLICY "Users read own, related, and owner-visible profiles"
ON public.profiles FOR SELECT TO authenticated
USING (
  id = auth.uid() OR public.has_role(auth.uid(), 'owner')
  OR EXISTS (SELECT 1 FROM public.applications a JOIN public.jobs j ON j.id = a.job_id
    WHERE (a.freelancer_id = profiles.id AND j.client_id = auth.uid())
       OR (j.client_id = profiles.id AND a.freelancer_id = auth.uid()))
  OR EXISTS (SELECT 1 FROM public.messages m WHERE
    (m.sender_id = auth.uid() AND m.recipient_id = profiles.id) OR
    (m.recipient_id = auth.uid() AND m.sender_id = profiles.id))
);
CREATE POLICY "Users update own profile and owners manage all profiles"
ON public.profiles FOR UPDATE TO authenticated
USING (id = auth.uid() OR public.has_role(auth.uid(), 'owner'))
WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(), 'owner'));

CREATE POLICY "Anyone can read active open jobs"
ON public.jobs FOR SELECT TO anon, authenticated USING (status = 'open');
CREATE POLICY "Clients and owners read their additional jobs"
ON public.jobs FOR SELECT TO authenticated
USING (client_id = auth.uid() OR public.has_role(auth.uid(), 'owner'));
CREATE POLICY "Clients and owners create jobs"
ON public.jobs FOR INSERT TO authenticated
WITH CHECK (client_id = auth.uid() AND (public.has_role(auth.uid(), 'client') OR public.has_role(auth.uid(), 'owner')));
CREATE POLICY "Clients and owners update jobs"
ON public.jobs FOR UPDATE TO authenticated
USING ((client_id = auth.uid() AND public.has_role(auth.uid(), 'client')) OR public.has_role(auth.uid(), 'owner'))
WITH CHECK ((client_id = auth.uid() AND public.has_role(auth.uid(), 'client')) OR public.has_role(auth.uid(), 'owner'));
CREATE POLICY "Clients and owners remove jobs"
ON public.jobs FOR DELETE TO authenticated
USING ((client_id = auth.uid() AND public.has_role(auth.uid(), 'client')) OR public.has_role(auth.uid(), 'owner'));

CREATE POLICY "Freelancers, job clients, and owners read applications"
ON public.applications FOR SELECT TO authenticated
USING (freelancer_id = auth.uid() OR public.has_role(auth.uid(), 'owner') OR
  EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = applications.job_id AND j.client_id = auth.uid()));
CREATE POLICY "Freelancers apply to open jobs once"
ON public.applications FOR INSERT TO authenticated
WITH CHECK (freelancer_id = auth.uid() AND public.has_role(auth.uid(), 'freelancer') AND
  EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = applications.job_id AND j.status = 'open'));
CREATE POLICY "Job clients and owners update application status"
ON public.applications FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'owner') OR EXISTS
  (SELECT 1 FROM public.jobs j WHERE j.id = applications.job_id AND j.client_id = auth.uid()))
WITH CHECK (public.has_role(auth.uid(), 'owner') OR EXISTS
  (SELECT 1 FROM public.jobs j WHERE j.id = applications.job_id AND j.client_id = auth.uid()));
CREATE POLICY "Owners remove applications"
ON public.applications FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'owner'));

CREATE POLICY "Participants and owners read messages"
ON public.messages FOR SELECT TO authenticated
USING (sender_id = auth.uid() OR recipient_id = auth.uid() OR public.has_role(auth.uid(), 'owner'));
CREATE POLICY "Application participants and owners send messages"
ON public.messages FOR INSERT TO authenticated
WITH CHECK (sender_id = auth.uid() AND (public.has_role(auth.uid(), 'owner') OR EXISTS
  (SELECT 1 FROM public.jobs j JOIN public.applications a ON a.job_id = j.id
   WHERE j.id = messages.job_id AND
     ((j.client_id = auth.uid() AND a.freelancer_id = messages.recipient_id) OR
      (j.client_id = messages.recipient_id AND a.freelancer_id = auth.uid())))));
CREATE POLICY "Owners remove messages"
ON public.messages FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'owner'));

CREATE POLICY "Only owners read reports"
ON public.reports FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'owner'));
CREATE POLICY "Members report another account"
ON public.reports FOR INSERT TO authenticated
WITH CHECK (reporter_id = auth.uid() AND target_id IS NOT NULL AND target_id <> auth.uid());
CREATE POLICY "Only owners update reports"
ON public.reports FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'owner')) WITH CHECK (public.has_role(auth.uid(), 'owner'));
CREATE POLICY "Only owners remove reports"
ON public.reports FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'owner'));

CREATE OR REPLACE FUNCTION public.set_profile_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_profile_updated_at();

CREATE OR REPLACE FUNCTION public.prevent_role_selection_edit()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.role_selected IS DISTINCT FROM OLD.role_selected AND current_user = 'authenticated' THEN
    RAISE EXCEPTION 'Role selection is managed by the account setup flow';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER profiles_protect_role_selection BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_role_selection_edit();

CREATE OR REPLACE FUNCTION public.set_initial_role(_role public.pmps_role)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE already_selected boolean;
BEGIN
  IF auth.uid() IS NULL OR _role NOT IN ('client', 'freelancer') THEN RETURN false; END IF;
  SELECT role_selected INTO already_selected FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR already_selected THEN RETURN false; END IF;
  DELETE FROM public.user_roles WHERE user_id = auth.uid();
  INSERT INTO public.user_roles (user_id, role) VALUES (auth.uid(), _role);
  UPDATE public.profiles SET role_selected = true WHERE id = auth.uid();
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.set_initial_role(public.pmps_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_initial_role(public.pmps_role) TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_pmps_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE assigned_role public.pmps_role; role_is_selected boolean; name_value text;
BEGIN
  IF lower(COALESCE(NEW.email, '')) = 'sivashanmugam51015@gmail.com' THEN
    assigned_role := 'owner'; role_is_selected := true;
  ELSIF NEW.raw_user_meta_data ->> 'role' IN ('client', 'freelancer') THEN
    assigned_role := (NEW.raw_user_meta_data ->> 'role')::public.pmps_role; role_is_selected := true;
  ELSE
    assigned_role := 'freelancer'; role_is_selected := false;
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
CREATE TRIGGER on_auth_user_created_pmps AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_pmps_user();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'reports') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reports;
  END IF;
END $$;