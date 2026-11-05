CREATE POLICY "Selected freelancers respond to their own jobs"
ON public.applications FOR UPDATE TO authenticated
USING (
  freelancer_id = auth.uid()
  AND status = 'selected'
  AND freelancer_response = 'pending'
  AND public.has_role(auth.uid(), 'freelancer')
)
WITH CHECK (
  freelancer_id = auth.uid()
  AND status = 'selected'
  AND freelancer_response IN ('accepted', 'declined')
  AND public.has_role(auth.uid(), 'freelancer')
);