GRANT INSERT, DELETE ON public.user_roles TO authenticated;

CREATE POLICY "admins atribuem cargos" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (
    public.user_rank(auth.uid()) >= 3
    AND public.role_rank(role) < public.user_rank(auth.uid())
  );

CREATE POLICY "admins removem cargos" ON public.user_roles FOR DELETE TO authenticated
  USING (
    public.user_rank(auth.uid()) >= 3
    AND public.role_rank(role) < public.user_rank(auth.uid())
  );