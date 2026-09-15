import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, ChevronDown, Crown, Hash, Lock, LogOut, Pencil, Plus, Send, Settings, Shield, Trash2, UserMinus, Users, Volume2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { VoiceRoom } from "@/components/VoiceRoom";
import { CUSTOM_PERMISSION_LABEL, CUSTOM_PERMISSIONS, ROLE_LABEL, ROLE_ORDER, ROLE_RANK, ROLE_STYLE, topRole, type AppRole, type CustomPermission } from "@/lib/espancord";

export const Route = createFileRoute("/_authenticated/servidor")({
  head: () => ({ meta: [{ title: "Espancord — Comunidade de Apostas" }, { name: "description", content: "Comunidade privada de apostas, CPA, delay e operações ao vivo." }] }),
  component: Servidor,
});

type Channel = { id: string; name: string; type: "texto" | "voz"; min_role: AppRole; position: number };
type Message = { id: string; channel_id: string; user_id: string; content: string; created_at: string };
type CustomRole = { id: string; name: string; color: string; position: number; permissions: CustomPermission[] };
type Status = "active" | "kicked" | "banned";
type Member = { id: string; display_name: string; avatar_url: string | null; roles: AppRole[]; customRoles: CustomRole[]; status: Status };
type ServerSettings = { name: string; description: string; accent_color: string };
const DEFAULT_SERVER: ServerSettings = { name: "ESPANCORD APOSTAS", description: "CPA • Delay esportivo • Operações ao vivo", accent_color: "#36d576" };
const db = supabase as any;
const inputClass = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30";

function hasPermission(member: Member | undefined, permission: CustomPermission) {
  if (!member) return false;
  const rank = ROLE_RANK[topRole(member.roles)];
  if (rank >= 3) return true;
  if (rank >= 2 && ["manage_messages", "kick_members"].includes(permission)) return true;
  return member.customRoles.some((role) => role.permissions.includes(permission));
}

function Servidor() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = Route.useRouteContext();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adminOpen, setAdminOpen] = useState(false);
  const [memberOpen, setMemberOpen] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const membersQuery = useQuery({
    queryKey: ["members"],
    queryFn: async (): Promise<Member[]> => {
      const [profiles, baseRoles, customRoles, links, statuses] = await Promise.all([
        supabase.from("profiles").select("id, display_name, avatar_url"),
        supabase.from("user_roles").select("user_id, role"),
        db.from("server_roles").select("id,name,color,position,permissions").order("position", { ascending: false }),
        db.from("member_server_roles").select("user_id,role_id"),
        db.from("server_member_status").select("user_id,status"),
      ]);
      if (profiles.error) throw profiles.error;
      if (baseRoles.error) throw baseRoles.error;
      const cr = (customRoles.data ?? []) as CustomRole[];
      return (profiles.data ?? []).map((p) => ({
        id: p.id,
        display_name: p.display_name,
        avatar_url: p.avatar_url,
        roles: (baseRoles.data ?? []).filter((r) => r.user_id === p.id).map((r) => r.role as AppRole),
        customRoles: (links.data ?? []).filter((l: any) => l.user_id === p.id).map((l: any) => cr.find((r) => r.id === l.role_id)).filter(Boolean) as CustomRole[],
        status: ((statuses.data ?? []).find((s: any) => s.user_id === p.id)?.status ?? "active") as Status,
      }));
    },
  });

  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const me = members.find((m) => m.id === user.id);
  const myRole = topRole(me?.roles ?? ["membro"]);
  const myRank = ROLE_RANK[myRole];
  const isAdmin = myRank >= 3;
  const canServer = hasPermission(me, "manage_server");
  const canChannels = hasPermission(me, "manage_channels");
  const canMessages = hasPermission(me, "manage_messages");
  const canKick = hasPermission(me, "kick_members");
  const canBan = hasPermission(me, "ban_members");

  const rolesQuery = useQuery({ queryKey: ["server-roles"], queryFn: async (): Promise<CustomRole[]> => {
    const { data } = await db.from("server_roles").select("id,name,color,position,permissions").order("position", { ascending: false });
    return (data ?? []) as CustomRole[];
  }});
  const customRoles = rolesQuery.data ?? [];

  const settingsQuery = useQuery({ queryKey: ["server-settings"], queryFn: async (): Promise<ServerSettings> => {
    const { data } = await db.from("server_settings").select("name,description,accent_color").eq("id", 1).maybeSingle();
    return (data as ServerSettings | null) ?? DEFAULT_SERVER;
  }});
  const server = settingsQuery.data ?? DEFAULT_SERVER;

  const channelsQuery = useQuery({ queryKey: ["channels"], queryFn: async (): Promise<Channel[]> => {
    const { data, error } = await supabase.from("channels").select("id,name,type,min_role,position").order("position");
    if (error) throw error;
    return (data ?? []) as Channel[];
  }});
  const channels = channelsQuery.data ?? [];
  const active = channels.find((c) => c.id === activeId) ?? channels.find((c) => c.type === "texto") ?? null;
  useEffect(() => { if (!activeId && active) setActiveId(active.id); }, [active, activeId]);

  const messagesQuery = useQuery({
    queryKey: ["messages", active?.id], enabled: !!active && active.type === "texto",
    queryFn: async (): Promise<Message[]> => {
      const { data, error } = await supabase.from("messages").select("id,channel_id,user_id,content,created_at").eq("channel_id", active!.id).order("created_at").limit(200);
      if (error) throw error; return data ?? [];
    },
  });
  useEffect(() => {
    if (!active || active.type !== "texto") return;
    const rt = supabase.channel(`msgs-${active.id}`).on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `channel_id=eq.${active.id}` }, () => qc.invalidateQueries({ queryKey: ["messages", active.id] })).subscribe();
    return () => { void supabase.removeChannel(rt); };
  }, [active, qc]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messagesQuery.data]);

  async function sendMessage(e: FormEvent) {
    e.preventDefault(); if (!draft.trim() || !active) return;
    const text = draft.trim(); setDraft("");
    const { error } = await supabase.from("messages").insert({ channel_id: active.id, user_id: user.id, content: text });
    if (error) toast.error("Não foi possível enviar a mensagem.");
  }
  async function deleteMessage(id: string) {
    const { error } = await supabase.from("messages").delete().eq("id", id);
    if (error) toast.error("Você não pode apagar essa mensagem.");
  }
  async function signOut() {
    qc.clear(); await supabase.auth.signOut(); navigate({ to: "/auth", replace: true });
  }
  async function setBaseRole(memberId: string, role: AppRole) {
    const target = members.find((m) => m.id === memberId); if (!target || memberId === user.id) return;
    const removable = target.roles.filter((r) => ROLE_RANK[r] < myRank);
    if (removable.length) await supabase.from("user_roles").delete().eq("user_id", memberId).in("role", removable);
    const { error } = await supabase.from("user_roles").insert({ user_id: memberId, role });
    if (error) toast.error("Você não pode dar esse cargo."); else toast.success("Cargo atualizado.");
    qc.invalidateQueries({ queryKey: ["members"] });
  }
  async function toggleCustomRole(memberId: string, roleId: string, enabled: boolean) {
    const res = enabled ? await db.from("member_server_roles").insert({ user_id: memberId, role_id: roleId }) : await db.from("member_server_roles").delete().eq("user_id", memberId).eq("role_id", roleId);
    if (res.error) toast.error("Não foi possível alterar o cargo.");
    qc.invalidateQueries({ queryKey: ["members"] });
  }
  async function setStatus(memberId: string, status: Status) {
    const res = status === "active" ? await db.from("server_member_status").delete().eq("user_id", memberId) : await db.from("server_member_status").upsert({ user_id: memberId, status, updated_by: user.id });
    if (res.error) { toast.error("Ação não permitida."); return; }
    toast.success(status === "banned" ? "Membro banido." : status === "kicked" ? "Membro expulso." : "Membro restaurado.");
    setMemberOpen(null); qc.invalidateQueries({ queryKey: ["members"] });
  }
  const selected = members.find((m) => m.id === memberOpen) ?? null;
  const visibleMembers = isAdmin ? members : members.filter((m) => m.status === "active");
  const nameOf = (id: string) => members.find((m) => m.id === id)?.display_name ?? "Membro";

  return <div className="flex h-screen overflow-hidden bg-background text-foreground">
    <aside className="hidden w-[72px] shrink-0 flex-col items-center gap-3 border-r border-white/5 bg-[#090f0c] py-3 md:flex">
      <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-primary font-display text-lg font-black text-primary-foreground">E<span className="absolute -left-3 h-8 w-1 rounded-r bg-white" /></div>
      <div className="h-px w-8 bg-white/10" /><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/5 text-primary"><Crown className="h-4 w-4" /></div>
    </aside>

    <aside className="flex w-[74px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar sm:w-64">
      <button onClick={() => (canServer || canChannels || isAdmin) && setAdminOpen(true)} className="flex h-14 items-center justify-between border-b border-sidebar-border px-3 hover:bg-sidebar-accent/60 sm:px-4">
        <div className="min-w-0"><b className="hidden truncate font-display text-sm sm:block">{server.name}</b><span className="hidden truncate text-[10px] text-muted-foreground sm:block">{server.description}</span><Settings className="mx-auto h-5 w-5 text-primary sm:hidden" /></div>
        {(canServer || canChannels || isAdmin) && <ChevronDown className="hidden h-4 w-4 text-muted-foreground sm:block" />}
      </button>
      <div className="flex-1 overflow-y-auto p-2">
        <Section title="COMUNIDADE" />
        {channels.filter((c) => c.type === "texto").map((c) => <ChannelButton key={c.id} channel={c} active={active?.id === c.id} onClick={() => setActiveId(c.id)} />)}
        <Section title="CALLS & OPERAÇÕES" extra="mt-5" />
        {channels.filter((c) => c.type === "voz").map((c) => <ChannelButton key={c.id} channel={c} active={active?.id === c.id} onClick={() => setActiveId(c.id)} />)}
        {(canServer || canChannels || isAdmin) && <button onClick={() => setAdminOpen(true)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-2 py-2 text-xs font-semibold text-primary sm:justify-start"><Settings className="h-4 w-4" /><span className="hidden sm:inline">Configurar servidor</span></button>}
      </div>
      <div className="flex items-center gap-2 border-t border-sidebar-border p-2 sm:p-3"><Avatar member={me} small /><div className="hidden min-w-0 flex-1 sm:block"><p className="truncate text-sm font-semibold">{me?.display_name ?? "Você"}</p><span className={`rounded border px-1.5 text-[9px] uppercase ${ROLE_STYLE[myRole]}`}>{ROLE_LABEL[myRole]}</span></div><button onClick={signOut} className="hidden p-2 text-muted-foreground sm:block"><LogOut className="h-4 w-4" /></button></div>
    </aside>

    <main className="flex min-w-0 flex-1 flex-col bg-[#101713]">
      <header className="flex h-14 items-center gap-3 border-b border-border px-4 sm:px-5">{active?.type === "voz" ? <Volume2 className="h-5 w-5 text-primary" /> : <Hash className="h-5 w-5 text-muted-foreground" />}<div className="min-w-0"><h1 className="truncate font-display text-sm font-bold">{active?.name ?? "Sem canal"}</h1><p className="hidden text-[11px] text-muted-foreground sm:block">{active?.type === "voz" ? "Call, câmera e transmissão de tela" : "Comunidade Espancord"}</p></div><span className="ml-auto hidden rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-[10px] font-bold text-primary sm:block">APOSTAS • CPA • DELAY</span></header>
      {active?.type === "voz" ? <VoiceRoom key={active.id} channelId={active.id} channelName={active.name} userId={user.id} userName={me?.display_name ?? "Você"} /> : <>
        <div className="flex-1 overflow-y-auto px-3 py-5 sm:px-5">{(messagesQuery.data ?? []).map((m) => <div key={m.id} className="group flex gap-3 rounded-lg px-2 py-2 hover:bg-white/[.025]"><Avatar member={members.find((x) => x.id === m.user_id)} /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><b className="truncate text-sm">{nameOf(m.user_id)}</b><span className="text-[10px] text-muted-foreground">{new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>{(m.user_id === user.id || canMessages) && <button onClick={() => void deleteMessage(m.id)} className="ml-auto opacity-0 text-muted-foreground group-hover:opacity-100 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>}</div><p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground/90">{m.content}</p></div></div>)}<div ref={bottom} /></div>
        <form onSubmit={sendMessage} className="px-3 pb-4 sm:px-5"><div className="flex rounded-xl border border-input bg-card p-1.5"><input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Mensagem em #${active?.name ?? ""}`} className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none" /><button className="rounded-lg bg-primary px-3 text-primary-foreground"><Send className="h-4 w-4" /></button></div></form>
      </>}
    </main>

    <aside className="hidden w-64 shrink-0 flex-col border-l border-border bg-sidebar xl:flex"><div className="flex h-14 items-center border-b border-sidebar-border px-4 text-xs font-bold uppercase tracking-wider text-muted-foreground"><Users className="mr-2 h-4 w-4" /> Membros — {visibleMembers.length}</div><div className="flex-1 overflow-y-auto p-2">{visibleMembers.map((m) => <button key={m.id} onClick={() => setMemberOpen(m.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-sidebar-accent"><Avatar member={m} small /><div className="min-w-0 flex-1"><div className="flex items-center gap-1"><span className="truncate text-sm font-medium">{m.display_name}</span>{topRole(m.roles) === "dono" && <Crown className="h-3 w-3 text-accent" />}</div><div className="mt-0.5 flex gap-1">{m.status !== "active" ? <span className="text-[9px] font-bold text-destructive">{m.status === "banned" ? "BANIDO" : "EXPULSO"}</span> : m.customRoles.length ? m.customRoles.slice(0, 2).map((r) => <span key={r.id} className="text-[9px] font-bold" style={{ color: r.color }}>{r.name}</span>) : <span className="text-[9px] text-muted-foreground">{ROLE_LABEL[topRole(m.roles)]}</span>}</div></div></button>)}</div></aside>

    {adminOpen && <AdminPanel channels={channels} members={members} roles={customRoles} server={server} canServer={canServer} canChannels={canChannels} canRoles={isAdmin} onClose={() => setAdminOpen(false)} onRefresh={() => { qc.invalidateQueries({ queryKey: ["channels"] }); qc.invalidateQueries({ queryKey: ["server-roles"] }); qc.invalidateQueries({ queryKey: ["members"] }); qc.invalidateQueries({ queryKey: ["server-settings"] }); }} onSelect={setMemberOpen} />}
    {selected && <MemberPanel member={selected} me={me} myRank={myRank} roles={customRoles} isAdmin={isAdmin} canKick={canKick} canBan={canBan} onClose={() => setMemberOpen(null)} onBase={setBaseRole} onCustom={toggleCustomRole} onStatus={setStatus} />}
  </div>;
}

function ChannelButton({ channel, active, onClick }: { channel: Channel; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={`mb-0.5 flex w-full items-center justify-center gap-2 rounded-md px-2 py-2 text-sm sm:justify-start ${active ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60"}`}>{channel.type === "voz" ? <Volume2 className="h-4 w-4" /> : <Hash className="h-4 w-4" />}<span className="hidden truncate sm:inline">{channel.name}</span>{channel.min_role !== "membro" && <Lock className="ml-auto hidden h-3 w-3 text-primary sm:block" />}</button>;
}
function Section({ title, extra = "" }: { title: string; extra?: string }) { return <div className={`mb-1 hidden px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground sm:block ${extra}`}>{title}</div>; }
function Avatar({ member, small = false }: { member?: Member; small?: boolean }) { const c = small ? "h-8 w-8" : "h-10 w-10"; return member?.avatar_url ? <img src={member.avatar_url} alt="" className={`${c} shrink-0 rounded-full object-cover`} referrerPolicy="no-referrer" /> : <div className={`flex ${c} shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-bold`}>{(member?.display_name ?? "M")[0].toUpperCase()}</div>; }

function AdminPanel({ channels, members, roles, server, canServer, canChannels, canRoles, onClose, onRefresh, onSelect }: { channels: Channel[]; members: Member[]; roles: CustomRole[]; server: ServerSettings; canServer: boolean; canChannels: boolean; canRoles: boolean; onClose: () => void; onRefresh: () => void; onSelect: (id: string) => void }) {
  const [tab, setTab] = useState<"server" | "channels" | "roles" | "members">(canServer ? "server" : canChannels ? "channels" : "members");
  const [channelName, setChannelName] = useState(""); const [channelType, setChannelType] = useState<"texto" | "voz">("texto"); const [minRole, setMinRole] = useState<AppRole>("membro");
  const [roleName, setRoleName] = useState(""); const [roleColor, setRoleColor] = useState("#36d576"); const [permissions, setPermissions] = useState<CustomPermission[]>([]); const [editing, setEditing] = useState<string | null>(null);
  const [settings, setSettings] = useState(server);
  async function createChannel() { if (!channelName.trim()) return; const { error } = await supabase.from("channels").insert({ name: channelName.toLowerCase().trim().replace(/\s+/g, "-"), type: channelType, min_role: minRole, position: channels.length + 1 }); if (error) toast.error("Não foi possível criar o canal."); else { toast.success("Canal criado."); setChannelName(""); onRefresh(); } }
  async function deleteChannel(id: string) { const { error } = await supabase.from("channels").delete().eq("id", id); if (error) toast.error("Não foi possível excluir."); else onRefresh(); }
  async function saveRole() { if (!roleName.trim()) return; const payload = { name: roleName.trim(), color: roleColor, permissions }; const res = editing ? await db.from("server_roles").update(payload).eq("id", editing) : await db.from("server_roles").insert({ ...payload, position: roles.length + 1 }); if (res.error) toast.error("Não foi possível salvar o cargo."); else { toast.success("Cargo salvo."); setEditing(null); setRoleName(""); setPermissions([]); onRefresh(); } }
  async function deleteRole(id: string) { const { error } = await db.from("server_roles").delete().eq("id", id); if (error) toast.error("Não foi possível excluir."); else { setEditing(null); setRoleName(""); onRefresh(); } }
  async function saveServer() { const { error } = await db.from("server_settings").update(settings).eq("id", 1); if (error) toast.error("Não foi possível salvar."); else { toast.success("Servidor atualizado."); onRefresh(); } }
  function editRole(r: CustomRole) { setEditing(r.id); setRoleName(r.name); setRoleColor(r.color); setPermissions(r.permissions); setTab("roles"); }

  const tabs = [{ id: "server", label: "Visão geral", show: canServer }, { id: "channels", label: "Canais", show: canChannels }, { id: "roles", label: "Cargos", show: canRoles }, { id: "members", label: "Membros", show: true }] as const;
  return <div className="fixed inset-0 z-50 flex bg-black/85 backdrop-blur-sm"><aside className="hidden w-60 shrink-0 border-r border-border bg-sidebar p-4 sm:block"><p className="mb-5 font-display text-sm font-black text-primary">ESPANCORD</p>{tabs.filter((t) => t.show).map((t) => <button key={t.id} onClick={() => setTab(t.id)} className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${tab === t.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary"}`}>{t.id === "roles" ? <Shield className="h-4 w-4" /> : t.id === "members" ? <Users className="h-4 w-4" /> : <Settings className="h-4 w-4" />}{t.label}</button>)}</aside><div className="flex min-w-0 flex-1 flex-col"><header className="flex h-16 items-center border-b border-border px-4 sm:px-8"><div><h2 className="font-display text-lg font-bold">Gerenciar servidor</h2><p className="text-xs text-muted-foreground">Canais, cargos, membros e permissões</p></div><button onClick={onClose} className="ml-auto rounded-full border border-border p-2"><X className="h-5 w-5" /></button></header><div className="flex gap-2 overflow-x-auto border-b border-border p-2 sm:hidden">{tabs.filter((t) => t.show).map((t) => <button key={t.id} onClick={() => setTab(t.id)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${tab === t.id ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>{t.label}</button>)}</div><div className="flex-1 overflow-y-auto p-4 sm:p-8"><div className="mx-auto max-w-3xl">
    {tab === "server" && canServer && <><Heading title="Visão geral" text="Identidade principal do servidor." /><div className="mt-5 space-y-4 rounded-2xl border border-border bg-card p-5"><input className={inputClass} value={settings.name} onChange={(e) => setSettings({ ...settings, name: e.target.value })} placeholder="Nome do servidor" /><textarea className={inputClass} rows={3} value={settings.description} onChange={(e) => setSettings({ ...settings, description: e.target.value })} /><div className="flex items-center gap-3"><input type="color" value={settings.accent_color} onChange={(e) => setSettings({ ...settings, accent_color: e.target.value })} className="h-10 w-14" /><span className="text-sm text-muted-foreground">Cor de destaque</span></div><button onClick={() => void saveServer()} className="rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground">Salvar</button></div></>}
    {tab === "channels" && canChannels && <><Heading title="Canais" text="Crie e remova canais como no Discord." /><div className="mt-5 grid gap-2 rounded-2xl border border-border bg-card p-5 sm:grid-cols-3"><input className={`${inputClass} sm:col-span-3`} value={channelName} onChange={(e) => setChannelName(e.target.value)} placeholder="nome-do-canal" /><select className={inputClass} value={channelType} onChange={(e) => setChannelType(e.target.value as "texto" | "voz")}><option value="texto">Texto</option><option value="voz">Voz / live</option></select><select className={inputClass} value={minRole} onChange={(e) => setMinRole(e.target.value as AppRole)}>{ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]} ou acima</option>)}</select><button onClick={() => void createChannel()} className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"><Plus className="mr-1 inline h-4 w-4" />Criar</button></div><div className="mt-4 space-y-2">{channels.map((c) => <div key={c.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">{c.type === "voz" ? <Volume2 className="h-4 w-4 text-primary" /> : <Hash className="h-4 w-4" />}<span className="flex-1 text-sm font-semibold">{c.name}</span><span className="text-xs text-muted-foreground">{ROLE_LABEL[c.min_role]}</span><button onClick={() => void deleteChannel(c.id)} className="p-2 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button></div>)}</div></>}
    {tab === "roles" && canRoles && <><Heading title="Cargos" text="Crie cargos personalizados com cor e permissões." /><div className="mt-5 grid gap-4 lg:grid-cols-[220px_1fr]"><div className="space-y-2"><button onClick={() => { setEditing(null); setRoleName(""); setPermissions([]); }} className="flex w-full items-center gap-2 rounded-lg border border-dashed border-primary/40 px-3 py-2 text-sm font-bold text-primary"><Plus className="h-4 w-4" />Novo cargo</button>{roles.map((r) => <button key={r.id} onClick={() => editRole(r)} className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: r.color }} /><span className="flex-1 truncate text-sm font-semibold">{r.name}</span><Pencil className="h-3.5 w-3.5" /></button>)}</div><div className="rounded-2xl border border-border bg-card p-5"><div className="flex items-center"><h3 className="font-bold">{editing ? "Editar cargo" : "Novo cargo"}</h3>{editing && <button onClick={() => void deleteRole(editing)} className="ml-auto text-destructive"><Trash2 className="h-4 w-4" /></button>}</div><div className="mt-4 space-y-3"><input className={inputClass} value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="Ex.: Trader VIP" /><div className="flex items-center gap-3"><input type="color" value={roleColor} onChange={(e) => setRoleColor(e.target.value)} className="h-10 w-14" /><span className="rounded-full border px-3 py-1 text-xs font-bold" style={{ color: roleColor, borderColor: roleColor }}>{roleName || "Cargo"}</span></div>{CUSTOM_PERMISSIONS.map((p) => <label key={p} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background/50 p-3"><input type="checkbox" checked={permissions.includes(p)} onChange={(e) => setPermissions(e.target.checked ? [...permissions, p] : permissions.filter((x) => x !== p))} className="mt-1" /><div><p className="text-sm font-semibold">{CUSTOM_PERMISSION_LABEL[p].title}</p><p className="text-xs text-muted-foreground">{CUSTOM_PERMISSION_LABEL[p].description}</p></div></label>)}<button onClick={() => void saveRole()} className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground">Salvar cargo</button></div></div></div></>}
    {tab === "members" && <><Heading title="Membros" text="Clique para administrar cargos, expulsar ou banir." /><div className="mt-5 overflow-hidden rounded-2xl border border-border bg-card">{members.map((m) => <button key={m.id} onClick={() => onSelect(m.id)} className="flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left last:border-0 hover:bg-secondary/40"><Avatar member={m} /><div className="min-w-0 flex-1"><b className="block truncate text-sm">{m.display_name}</b><div className="mt-1 flex gap-1"><span className={`rounded border px-1.5 text-[9px] uppercase ${ROLE_STYLE[topRole(m.roles)]}`}>{ROLE_LABEL[topRole(m.roles)]}</span>{m.customRoles.map((r) => <span key={r.id} className="rounded border px-1.5 text-[9px] font-bold" style={{ color: r.color }}>{r.name}</span>)}</div></div>{m.status !== "active" && <span className="text-xs font-bold text-destructive">{m.status === "banned" ? "BANIDO" : "EXPULSO"}</span>}</button>)}</div></>}
  </div></div></div></div>;
}

function MemberPanel({ member, me, myRank, roles, isAdmin, canKick, canBan, onClose, onBase, onCustom, onStatus }: { member: Member; me?: Member; myRank: number; roles: CustomRole[]; isAdmin: boolean; canKick: boolean; canBan: boolean; onClose: () => void; onBase: (id: string, role: AppRole) => Promise<void>; onCustom: (id: string, roleId: string, enabled: boolean) => Promise<void>; onStatus: (id: string, status: Status) => Promise<void> }) {
  const targetRank = ROLE_RANK[topRole(member.roles)]; const self = member.id === me?.id; const canTouch = !self && myRank > targetRank;
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}><div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card" onMouseDown={(e) => e.stopPropagation()}><div className="h-20 bg-gradient-to-r from-primary/40 to-accent/20" /><div className="relative px-5 pb-5"><div className="absolute -top-8 left-5 rounded-full border-4 border-card"><Avatar member={member} /></div><button onClick={onClose} className="absolute right-4 top-3 rounded-full bg-black/30 p-1.5"><X className="h-4 w-4" /></button><div className="pt-8"><h3 className="font-display text-lg font-bold">{member.display_name}</h3><div className="mt-2 flex flex-wrap gap-1"><span className={`rounded border px-2 py-0.5 text-[10px] uppercase ${ROLE_STYLE[topRole(member.roles)]}`}>{ROLE_LABEL[topRole(member.roles)]}</span>{member.customRoles.map((r) => <span key={r.id} className="rounded border px-2 py-0.5 text-[10px] font-bold" style={{ color: r.color }}>{r.name}</span>)}</div></div>
    {isAdmin && canTouch && <div className="mt-5"><label className="text-[10px] font-bold uppercase text-muted-foreground">Cargo-base</label><select className={`${inputClass} mt-2`} value={topRole(member.roles)} onChange={(e) => void onBase(member.id, e.target.value as AppRole)}>{ROLE_ORDER.map((r) => <option key={r} value={r} disabled={ROLE_RANK[r] >= myRank}>{ROLE_LABEL[r]}</option>)}</select></div>}
    {isAdmin && canTouch && roles.length > 0 && <div className="mt-5"><label className="text-[10px] font-bold uppercase text-muted-foreground">Cargos personalizados</label><div className="mt-2 space-y-2 rounded-xl border border-border p-3">{roles.map((r) => { const checked = member.customRoles.some((x) => x.id === r.id); return <label key={r.id} className="flex items-center gap-3"><input type="checkbox" checked={checked} onChange={(e) => void onCustom(member.id, r.id, e.target.checked)} /><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.color }} /><span className="text-sm font-semibold">{r.name}</span></label>; })}</div></div>}
    {member.status !== "active" && isAdmin ? <button onClick={() => void onStatus(member.id, "active")} className="mt-5 w-full rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm font-bold text-primary">Restaurar acesso</button> : canTouch && (canKick || canBan) ? <div className="mt-5 grid grid-cols-2 gap-2 border-t border-border pt-4">{canKick && <button onClick={() => void onStatus(member.id, "kicked")} className="flex items-center justify-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2.5 text-sm font-bold text-accent"><UserMinus className="h-4 w-4" />Expulsar</button>}{canBan && <button onClick={() => void onStatus(member.id, "banned")} className="flex items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm font-bold text-destructive"><Ban className="h-4 w-4" />Banir</button>}</div> : null}
  </div></div></div>;
}
function Heading({ title, text }: { title: string; text: string }) { return <div><h3 className="font-display text-xl font-bold">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{text}</p></div>; }
