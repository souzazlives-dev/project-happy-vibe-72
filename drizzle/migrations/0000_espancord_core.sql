-- Roles
CREATE TYPE public.app_role AS ENUM ('dono', 'admin', 'moderador', 'membro');
CREATE TYPE public.channel_type AS ENUM ('texto', 'voz');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT 'Membro',
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.role_rank(_role public.app_role)
RETURNS INT LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE _role WHEN 'dono' THEN 4 WHEN 'admin' THEN 3 WHEN 'moderador' THEN 2 ELSE 1 END;
$$;

CREATE OR REPLACE FUNCTION public.user_rank(_user_id UUID)
RETURNS INT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(MAX(public.role_rank(role)), 0) FROM public.user_roles WHERE user_id = _user_id;
$$;

-- Channels
CREATE TABLE public.channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type public.channel_type NOT NULL DEFAULT 'texto',
  min_role public.app_role NOT NULL DEFAULT 'membro',
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channels TO authenticated;
GRANT ALL ON public.channels TO service_role;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_channel_idx ON public.messages (channel_id, created_at);
GRANT SELECT, INSERT, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_access_channel(_user_id UUID, _channel_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.channels c
    WHERE c.id = _channel_id
      AND public.user_rank(_user_id) >= public.role_rank(c.min_role)
  );
$$;

-- Policies
CREATE POLICY "perfis visiveis para membros" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "editar proprio perfil" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "criar proprio perfil" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "cargos visiveis" ON public.user_roles FOR SELECT TO authenticated USING (true);

CREATE POLICY "ver canais permitidos" ON public.channels FOR SELECT TO authenticated
  USING (public.user_rank(auth.uid()) >= public.role_rank(min_role));
CREATE POLICY "admins criam canais" ON public.channels FOR INSERT TO authenticated
  WITH CHECK (public.user_rank(auth.uid()) >= 3);
CREATE POLICY "admins editam canais" ON public.channels FOR UPDATE TO authenticated
  USING (public.user_rank(auth.uid()) >= 3);
CREATE POLICY "admins apagam canais" ON public.channels FOR DELETE TO authenticated
  USING (public.user_rank(auth.uid()) >= 3);

CREATE POLICY "ler mensagens do canal" ON public.messages FOR SELECT TO authenticated
  USING (public.can_access_channel(auth.uid(), channel_id));
CREATE POLICY "enviar mensagens" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.can_access_channel(auth.uid(), channel_id));
CREATE POLICY "apagar propria ou moderar" ON public.messages FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.user_rank(auth.uid()) >= 2);

-- Novo usuario: cria perfil e cargo (primeiro vira dono)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1), 'Membro'),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'dono') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'dono') ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'membro') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Canais iniciais
INSERT INTO public.channels (name, type, min_role, position) VALUES
  ('geral', 'texto', 'membro', 1),
  ('avisos', 'texto', 'membro', 2),
  ('sala-de-voz', 'voz', 'membro', 3),
  ('staff', 'texto', 'moderador', 4);

ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;