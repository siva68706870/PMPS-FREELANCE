ALTER TABLE public.applications
ADD COLUMN freelancer_response text NOT NULL DEFAULT 'pending'
CHECK (freelancer_response IN ('pending', 'accepted', 'declined'));

CREATE OR REPLACE FUNCTION public.prevent_application_identity_edit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user = 'authenticated' THEN
    IF NEW.job_id IS DISTINCT FROM OLD.job_id OR NEW.freelancer_id IS DISTINCT FROM OLD.freelancer_id THEN
      RAISE EXCEPTION 'Application identity cannot be changed';
    END IF;
    IF public.has_role(auth.uid(), 'freelancer') THEN
      IF OLD.freelancer_id <> auth.uid()
         OR OLD.status <> 'selected'
         OR OLD.freelancer_response <> 'pending'
         OR NEW.status IS DISTINCT FROM OLD.status
         OR NEW.freelancer_response NOT IN ('accepted', 'declined') THEN
        RAISE EXCEPTION 'Freelancers can respond only to selected jobs';
      END IF;
    ELSIF NOT public.has_role(auth.uid(), 'owner') THEN
      IF NEW.freelancer_response IS DISTINCT FROM OLD.freelancer_response THEN
        RAISE EXCEPTION 'Only the selected freelancer can accept or decline a job';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.jobs
        WHERE id = OLD.job_id AND client_id = auth.uid()
      ) THEN
        RAISE EXCEPTION 'Only the job client can change application status';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

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
      WHERE j.id = messages.job_id
        AND ((j.client_id = auth.uid() AND a.freelancer_id = messages.recipient_id)
          OR (j.client_id = messages.recipient_id AND a.freelancer_id = auth.uid()))
    )
  )
);