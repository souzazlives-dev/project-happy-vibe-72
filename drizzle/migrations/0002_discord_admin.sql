-- Espancord: administração estilo Discord
CREATE TABLE public.server_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'ESPANCORD APOSTAS',
  description TEXT NOT NULL DEFAULT 'CPA • Delay esportivo • Operações ao vivo',
  accent_color TEXT NOT NULL DEFAULT '#36d576',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.server_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE public.server_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#36d576' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  position INT NOT NULL DEFAULT 0,
  permissions TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.member_server_roles (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES public.server_roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE public.server_member_status (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('kicked','banned')),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE ON public.server_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.server_roles TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.member_server_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.server_member_status TO authenticated;
GRANT ALL ON public.server_settings, public.server_roles, public.member_server_roles, public.server_member_status TO service_role;

ALTER TABLE public.server_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.server_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_server_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.server_member_status ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_enter_server(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.server_member_status s WHERE s.user_id=_user_id AND s.status IN ('kicked','banned'));
$$;

CREATE OR REPLACE FUNCTION public.has_permission(_user_id UUID, _permission TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.can_enter_server(_user_id) AND (
    public.user_rank(_user_id) >= 3
    OR (public.user_rank(_user_id) >= 2 AND _permission IN ('manage_messages','kick_members'))
    OR EXISTS (
      SELECT 1 FROM public.member_server_roles mr
      JOIN public.server_roles r ON r.id=mr.role_id
      WHERE mr.user_id=_user_id AND r.permissions @> ARRAY[_permission]::TEXT[]
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_moderate_member(_actor UUID, _target UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT _actor <> _target AND public.user_rank(_actor) > public.user_rank(_target);
$$;

CREATE OR REPLACE FUNCTION public.can_access_channel(_user_id UUID, _channel_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.can_enter_server(_user_id) AND EXISTS (
    SELECT 1 FROM public.channels c WHERE c.id=_channel_id
    AND public.user_rank(_user_id) >= public.role_rank(c.min_role)
  );
$$;

REVOKE ALL ON FUNCTION public.can_enter_server(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_permission(UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_moderate_member(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_enter_server(UUID), public.has_permission(UUID,TEXT), public.can_moderate_member(UUID,UUID) TO authenticated, service_role;

CREATE POLICY "membros veem configuracoes" ON public.server_settings FOR SELECT TO authenticated USING (public.can_enter_server(auth.uid()));
CREATE POLICY "admins editam configuracoes" ON public.server_settings FOR UPDATE TO authenticated USING (public.has_permission(auth.uid(),'manage_server')) WITH CHECK (public.has_permission(auth.uid(),'manage_server'));
CREATE POLICY "membros veem cargos" ON public.server_roles FOR SELECT TO authenticated USING (public.can_enter_server(auth.uid()));
CREATE POLICY "admins criam cargos" ON public.server_roles FOR INSERT TO authenticated WITH CHECK (public.user_rank(auth.uid())>=3);
CREATE POLICY "admins editam cargos" ON public.server_roles FOR UPDATE TO authenticated USING (public.user_rank(auth.uid())>=3) WITH CHECK (public.user_rank(auth.uid())>=3);
CREATE POLICY "admins apagam cargos" ON public.server_roles FOR DELETE TO authenticated USING (public.user_rank(auth.uid())>=3);
CREATE POLICY "membros veem atribuicoes" ON public.member_server_roles FOR SELECT TO authenticated USING (public.can_enter_server(auth.uid()));
CREATE POLICY "admins atribuem cargos custom" ON public.member_server_roles FOR INSERT TO authenticated WITH CHECK (public.user_rank(auth.uid())>=3);
CREATE POLICY "admins removem cargos custom" ON public.member_server_roles FOR DELETE TO authenticated USING (public.user_rank(auth.uid())>=3);
CREATE POLICY "moderacao ve status" ON public.server_member_status FOR SELECT TO authenticated USING (auth.uid()=user_id OR public.user_rank(auth.uid())>=2);
CREATE POLICY "moderacao aplica status" ON public.server_member_status FOR INSERT TO authenticated WITH CHECK (
  public.can_moderate_member(auth.uid(),user_id) AND ((status='kicked' AND public.has_permission(auth.uid(),'kick_members')) OR (status='banned' AND public.has_permission(auth.uid(),'ban_members')))
);
CREATE POLICY "moderacao atualiza status" ON public.server_member_status FOR UPDATE TO authenticated USING (public.can_moderate_member(auth.uid(),user_id)) WITH CHECK (
  public.can_moderate_member(auth.uid(),user_id) AND ((status='kicked' AND public.has_permission(auth.uid(),'kick_members')) OR (status='banned' AND public.has_permission(auth.uid(),'ban_members')))
);
CREATE POLICY "moderacao restaura" ON public.server_member_status FOR DELETE TO authenticated USING (public.can_moderate_member(auth.uid(),user_id) AND (public.has_permission(auth.uid(),'kick_members') OR public.has_permission(auth.uid(),'ban_members')));

DROP POLICY IF EXISTS "perfis visiveis para membros" ON public.profiles;
CREATE POLICY "perfis visiveis para membros" ON public.profiles FOR SELECT TO authenticated USING (public.can_enter_server(auth.uid()));
DROP POLICY IF EXISTS "cargos visiveis" ON public.user_roles;
CREATE POLICY "cargos visiveis" ON public.user_roles FOR SELECT TO authenticated USING (public.can_enter_server(auth.uid()));
DROP POLICY IF EXISTS "ver canais permitidos" ON public.channels;
CREATE POLICY "ver canais permitidos" ON public.channels FOR SELECT TO authenticated USING (public.can_access_channel(auth.uid(),id));
DROP POLICY IF EXISTS "admins criam canais" ON public.channels;
CREATE POLICY "gerenciar criacao de canais" ON public.channels FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(),'manage_channels'));
DROP POLICY IF EXISTS "admins editam canais" ON public.channels;
CREATE POLICY "gerenciar edicao de canais" ON public.channels FOR UPDATE TO authenticated USING (public.has_permission(auth.uid(),'manage_channels')) WITH CHECK (public.has_permission(auth.uid(),'manage_channels'));
DROP POLICY IF EXISTS "admins apagam canais" ON public.channels;
CREATE POLICY "gerenciar exclusao de canais" ON public.channels FOR DELETE TO authenticated USING (public.has_permission(auth.uid(),'manage_channels'));
DROP POLICY IF EXISTS "ler mensagens do canal" ON public.messages;
CREATE POLICY "ler mensagens do canal" ON public.messages FOR SELECT TO authenticated USING (public.can_access_channel(auth.uid(),channel_id));
DROP POLICY IF EXISTS "enviar mensagens" ON public.messages;
CREATE POLICY "enviar mensagens" ON public.messages FOR INSERT TO authenticated WITH CHECK (auth.uid()=user_id AND public.can_access_channel(auth.uid(),channel_id));
DROP POLICY IF EXISTS "apagar propria ou moderar" ON public.messages;
CREATE POLICY "apagar propria ou moderar" ON public.messages FOR DELETE TO authenticated USING (auth.uid()=user_id OR public.has_permission(auth.uid(),'manage_messages'));

UPDATE public.channels SET name='chat-geral' WHERE name='geral';
UPDATE public.channels SET name='operacoes-ao-vivo' WHERE name='sala-de-voz';
INSERT INTO public.channels (name,type,min_role,position)
SELECT 'cpa-chines','texto','membro',COALESCE(MAX(position),0)+1 FROM public.channels
WHERE NOT EXISTS (SELECT 1 FROM public.channels WHERE name='cpa-chines');
INSERT INTO public.channels (name,type,min_role,position)
SELECT 'delay-esportivo','texto','membro',COALESCE(MAX(position),0)+1 FROM public.channels
WHERE NOT EXISTS (SELECT 1 FROM public.channels WHERE name='delay-esportivo');
