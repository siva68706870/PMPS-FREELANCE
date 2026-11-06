CREATE OR REPLACE VIEW public.open_job_clients AS
SELECT DISTINCT
  p.id,
  p.display_name,
  p.avatar_url,
  p.headline,
  p.location,
  p.company_name
FROM public.profiles p
JOIN public.user_roles r ON r.user_id = p.id AND r.role = 'client'
JOIN public.jobs j ON j.client_id = p.id AND j.status = 'open'
WHERE p.account_state = 'active';
GRANT SELECT ON public.open_job_clients TO anon, authenticated, service_role;