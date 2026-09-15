-- Espancord: canais privados por cargo + permissão de gerenciar cargos
CREATE TABLE public.channel_role_access (
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES public.server_roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, role_id)
);

CREATE INDEX channel_role_access_channel_idx ON public.channel_role_access(channel_id);
CREATE INDEX channel_role_access_role_idx ON public.channel_role_access(role_id);

GRANT SELECT, INSERT, DELETE ON public.channel_role_access TO authenticated;
GRANT ALL ON public.channel_role_access TO service_role;
ALTER TABLE public.channel_role_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins criam cargos" ON public.server_roles;
DROP POLICY IF EXISTS "admins editam cargos" ON public.server_roles;
DROP POLICY IF EXISTS "admins apagam cargos" ON public.server_roles;

CREATE POLICY "gestores criam cargos" ON public.server_roles FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'manage_roles') OR public.user_rank(auth.uid()) >= 3);
CREATE POLICY "gestores editam cargos" ON public.server_roles FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'manage_roles') OR public.user_rank(auth.uid()) >= 3)
  WITH CHECK (public.has_permission(auth.uid(), 'manage_roles') OR public.user_rank(auth.uid()) >= 3);
CREATE POLICY "gestores apagam cargos" ON public.server_roles FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), 'manage_roles') OR public.user_rank(auth.uid()) >= 3);

DROP POLICY IF EXISTS "admins atribuem cargos custom" ON public.member_server_roles;
DROP POLICY IF EXISTS "admins removem cargos custom" ON public.member_server_roles;
CREATE POLICY "gestores atribuem cargos custom" ON public.member_server_roles FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'manage_roles') OR public.user_rank(auth.uid()) >= 3);
CREATE POLICY "gestores removem cargos custom" ON public.member_server_roles FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), 'manage_roles') OR public.user_rank(auth.uid()) >= 3);

CREATE POLICY "membros veem restricoes de canais" ON public.channel_role_access FOR SELECT TO authenticated
  USING (public.can_enter_server(auth.uid()));
CREATE POLICY "gestores criam restricoes de canais" ON public.channel_role_access FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'manage_channels'));
CREATE POLICY "gestores removem restricoes de canais" ON public.channel_role_access FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), 'manage_channels'));

CREATE OR REPLACE FUNCTION public.can_access_channel(_user_id UUID, _channel_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.can_enter_server(_user_id) AND EXISTS (
    SELECT 1
    FROM public.channels c
    WHERE c.id = _channel_id
      AND (
        public.user_rank(_user_id) >= 3
        OR (
          public.user_rank(_user_id) >= public.role_rank(c.min_role)
          AND (
            NOT EXISTS (
              SELECT 1 FROM public.channel_role_access cra
              WHERE cra.channel_id = c.id
            )
            OR EXISTS (
              SELECT 1
              FROM public.channel_role_access cra
              JOIN public.member_server_roles msr ON msr.role_id = cra.role_id
              WHERE cra.channel_id = c.id
                AND msr.user_id = _user_id
            )
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_channel(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_channel(UUID, UUID) TO authenticated, service_role;
