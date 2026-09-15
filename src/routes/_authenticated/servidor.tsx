import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Hash, Volume2, Plus, LogOut, Lock, Send } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  ROLE_LABEL,
  ROLE_ORDER,
  ROLE_RANK,
  ROLE_STYLE,
  topRole,
  type AppRole,
} from "@/lib/espancord";

export const Route = createFileRoute("/_authenticated/servidor")({
  head: () => ({
    meta: [
      { title: "Servidor Espancord" },
      {
        name: "description",
        content:
          "Canais, conversas e cargos do servidor Espancord em um só lugar.",
      },
      { property: "og:title", content: "Servidor Espancord" },
      {
        property: "og:description",
        content: "Converse nos canais e gerencie os cargos do seu servidor.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Servidor,
});

type Channel = {
  id: string;
  name: string;
  type: "texto" | "voz";
  min_role: AppRole;
  position: number;
};

type Message = {
  id: string;
  channel_id: string;
  user_id: string;
  content: string;
  created_at: string;
};

type Member = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  roles: AppRole[];
};

function Servidor() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = Route.useRouteContext();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [showAdmin, setShowAdmin] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const membersQuery = useQuery({
    queryKey: ["members"],
    queryFn: async (): Promise<Member[]> => {
      const [{ data: profiles, error: pErr }, { data: roles, error: rErr }] =
        await Promise.all([
          supabase.from("profiles").select("id, display_name, avatar_url"),
          supabase.from("user_roles").select("user_id, role"),
        ]);
      if (pErr) throw pErr;
      if (rErr) throw rErr;
      return (profiles ?? []).map((p) => ({
        id: p.id,
        display_name: p.display_name,
        avatar_url: p.avatar_url,
        roles: (roles ?? [])
          .filter((r) => r.user_id === p.id)
          .map((r) => r.role as AppRole),
      }));
    },
  });

  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const me = members.find((m) => m.id === user.id);
  const myRole = topRole(me?.roles ?? ["membro"]);
  const myRank = ROLE_RANK[myRole];
  const isAdmin = myRank >= 3;

  const channelsQuery = useQuery({
    queryKey: ["channels"],
    queryFn: async (): Promise<Channel[]> => {
      const { data, error } = await supabase
        .from("channels")
        .select("id, name, type, min_role, position")
        .order("position");
      if (error) throw error;
      return (data ?? []) as Channel[];
    },
  });

  const channels = useMemo(
    () => channelsQuery.data ?? [],
    [channelsQuery.data],
  );
  const active =
    channels.find((c) => c.id === activeId) ??
    channels.find((c) => c.type === "texto") ??
    null;

  useEffect(() => {
    if (!activeId && active) setActiveId(active.id);
  }, [active, activeId]);

  const messagesQuery = useQuery({
    queryKey: ["messages", active?.id],
    enabled: !!active && active.type === "texto",
    queryFn: async (): Promise<Message[]> => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, channel_id, user_id, content, created_at")
        .eq("channel_id", active!.id)
        .order("created_at")
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!active) return;
    const channel = supabase
      .channel(`msgs-${active.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${active.id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["messages", active.id] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [active, queryClient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesQuery.data]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || !active) return;
    const content = draft.trim();
    setDraft("");
    const { error } = await supabase
      .from("messages")
      .insert({ channel_id: active.id, user_id: user.id, content });
    if (error) toast.error("Não foi possível enviar a mensagem.");
  }

  async function createChannel(
    name: string,
    type: "texto" | "voz",
    minRole: AppRole,
  ) {
    const { error } = await supabase.from("channels").insert({
      name: name.toLowerCase().replace(/\s+/g, "-"),
      type,
      min_role: minRole,
      position: channels.length + 1,
    });
    if (error) {
      toast.error("Não foi possível criar o canal.");
      return;
    }
    toast.success("Canal criado.");
    queryClient.invalidateQueries({ queryKey: ["channels"] });
  }

  async function setMemberRole(memberId: string, role: AppRole) {
    const target = members.find((m) => m.id === memberId);
    if (!target) return;
    const removable = target.roles.filter((r) => ROLE_RANK[r] < myRank);
    if (removable.length) {
      await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", memberId)
        .in("role", removable);
    }
    const { error } = await supabase
      .from("user_roles")
      .insert({ user_id: memberId, role });
    if (error) {
      toast.error("Você não pode dar esse cargo.");
    } else {
      toast.success("Cargo atualizado.");
    }
    queryClient.invalidateQueries({ queryKey: ["members"] });
  }

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const nameOf = (id: string) =>
    members.find((m) => m.id === id)?.display_name ?? "Membro";

  return (
    <div className="flex h-screen bg-background font-sans text-foreground">
      {/* Canais */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="border-b border-sidebar-border px-4 py-4">
          <span className="font-display text-sm font-bold tracking-widest text-primary">
            ESPANCORD
          </span>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {channels.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                active?.id === c.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60"
              }`}
            >
              {c.type === "voz" ? (
                <Volume2 className="h-4 w-4 shrink-0" />
              ) : (
                <Hash className="h-4 w-4 shrink-0" />
              )}
              <span className="truncate">{c.name}</span>
              {c.min_role !== "membro" && (
                <Lock className="ml-auto h-3 w-3 text-primary" />
              )}
            </button>
          ))}
          {isAdmin && (
            <button
              onClick={() => setShowAdmin(true)}
              className="mt-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-primary hover:bg-sidebar-accent/60"
            >
              <Plus className="h-4 w-4" /> Gerenciar servidor
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-sidebar-border p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {me?.display_name ?? "Você"}
            </p>
            <span
              className={`inline-block rounded border px-1.5 text-[10px] uppercase ${ROLE_STYLE[myRole]}`}
            >
              {ROLE_LABEL[myRole]}
            </span>
          </div>
          <button
            onClick={signOut}
            title="Sair"
            className="rounded-md p-2 text-muted-foreground hover:bg-sidebar-accent"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      {/* Conversa */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          {active?.type === "voz" ? (
            <Volume2 className="h-4 w-4 text-primary" />
          ) : (
            <Hash className="h-4 w-4 text-primary" />
          )}
          <h1 className="font-display text-sm font-semibold">
            {active?.name ?? "Sem canal"}
          </h1>
        </header>

        {active?.type === "voz" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <Volume2 className="h-10 w-10 text-primary" />
            <p className="font-display text-lg">Sala de voz {active.name}</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Chamada com câmera e transmissão de tela é a próxima etapa do
              Espancord.
            </p>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {(messagesQuery.data ?? []).map((m) => (
                <div key={m.id} className="flex gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold">
                    {nameOf(m.user_id).charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {nameOf(m.user_id)}{" "}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        {new Date(m.created_at).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </p>
                    <p className="whitespace-pre-wrap break-words text-sm text-foreground/90">
                      {m.content}
                    </p>
                  </div>
                </div>
              ))}
              {messagesQuery.data?.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nenhuma mensagem ainda. Comece a conversa!
                </p>
              )}
              <div ref={bottomRef} />
            </div>
            <form onSubmit={sendMessage} className="flex gap-2 p-4">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Mensagem em #${active?.name ?? ""}`}
                className="flex-1 rounded-md border border-input bg-card px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="submit"
                className="rounded-md bg-primary px-4 text-primary-foreground"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </>
        )}
      </main>

      {/* Membros */}
      <aside className="hidden w-60 shrink-0 flex-col border-l border-border bg-sidebar lg:flex">
        <div className="border-b border-sidebar-border px-4 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Membros — {members.length}
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {members.map((m) => {
            const r = topRole(m.roles);
            return (
              <div
                key={m.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                  {m.display_name.charAt(0).toUpperCase()}
                </div>
                <span className="truncate text-sm">{m.display_name}</span>
                <span
                  className={`ml-auto rounded border px-1.5 text-[10px] uppercase ${ROLE_STYLE[r]}`}
                >
                  {ROLE_LABEL[r]}
                </span>
              </div>
            );
          })}
        </div>
      </aside>

      {showAdmin && isAdmin && (
        <AdminPanel
          members={members}
          myRank={myRank}
          onClose={() => setShowAdmin(false)}
          onCreateChannel={createChannel}
          onSetRole={setMemberRole}
        />
      )}
    </div>
  );
}

function AdminPanel({
  members,
  myRank,
  onClose,
  onCreateChannel,
  onSetRole,
}: {
  members: Member[];
  myRank: number;
  onClose: () => void;
  onCreateChannel: (
    name: string,
    type: "texto" | "voz",
    minRole: AppRole,
  ) => Promise<void>;
  onSetRole: (memberId: string, role: AppRole) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"texto" | "voz">("texto");
  const [minRole, setMinRole] = useState<AppRole>("membro");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">
            Gerenciar servidor
          </h2>
          <button
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Fechar
          </button>
        </div>

        <h3 className="mt-6 text-sm font-semibold">Novo canal</h3>
        <div className="mt-2 space-y-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="nome-do-canal"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as "texto" | "voz")}
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="texto">Texto</option>
              <option value="voz">Voz</option>
            </select>
            <select
              value={minRole}
              onChange={(e) => setMinRole(e.target.value as AppRole)}
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {ROLE_ORDER.map((r) => (
                <option key={r} value={r}>
                  Acesso: {ROLE_LABEL[r]} ou acima
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={async () => {
              if (!name.trim()) return;
              await onCreateChannel(name, type, minRole);
              setName("");
            }}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Criar canal
          </button>
        </div>

        <h3 className="mt-8 text-sm font-semibold">Cargos dos membros</h3>
        <div className="mt-2 space-y-2">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">
                {m.display_name}
              </span>
              <select
                value={topRole(m.roles)}
                onChange={(e) => onSetRole(m.id, e.target.value as AppRole)}
                disabled={ROLE_RANK[topRole(m.roles)] >= myRank}
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-50"
              >
                {ROLE_ORDER.map((r) => (
                  <option key={r} value={r} disabled={ROLE_RANK[r] >= myRank}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
