export type AppRole = "dono" | "admin" | "moderador" | "membro";

export type CustomPermission =
  | "manage_server"
  | "manage_channels"
  | "manage_roles"
  | "manage_messages"
  | "kick_members"
  | "ban_members";

export const CUSTOM_PERMISSIONS: CustomPermission[] = [
  "manage_server",
  "manage_channels",
  "manage_roles",
  "manage_messages",
  "kick_members",
  "ban_members",
];

export const CUSTOM_PERMISSION_LABEL: Record<
  CustomPermission,
  { title: string; description: string }
> = {
  manage_server: {
    title: "Gerenciar servidor",
    description: "Editar nome, descrição e configurações gerais.",
  },
  manage_channels: {
    title: "Gerenciar canais",
    description: "Criar, renomear, restringir e excluir canais.",
  },
  manage_roles: {
    title: "Gerenciar cargos",
    description: "Criar, editar, excluir e atribuir cargos personalizados.",
  },
  manage_messages: {
    title: "Moderar mensagens",
    description: "Apagar mensagens de outros membros.",
  },
  kick_members: {
    title: "Expulsar membros",
    description: "Remover membros do servidor sem aplicar banimento.",
  },
  ban_members: {
    title: "Banir membros",
    description: "Bloquear o acesso de um membro ao servidor.",
  },
};

export const ROLE_ORDER: AppRole[] = ["dono", "admin", "moderador", "membro"];

export const ROLE_RANK: Record<AppRole, number> = {
  dono: 4,
  admin: 3,
  moderador: 2,
  membro: 1,
};

export const ROLE_LABEL: Record<AppRole, string> = {
  dono: "Dono",
  admin: "Admin",
  moderador: "Moderador",
  membro: "Membro",
};

export const ROLE_STYLE: Record<AppRole, string> = {
  dono: "bg-primary/20 text-primary border-primary/40",
  admin: "bg-accent/20 text-accent border-accent/40",
  moderador: "bg-chart-3/20 text-chart-3 border-chart-3/40",
  membro: "bg-muted text-muted-foreground border-border",
};

export function topRole(roles: AppRole[]): AppRole {
  return roles.reduce<AppRole>(
    (best, role) => (ROLE_RANK[role] > ROLE_RANK[best] ? role : best),
    "membro",
  );
}
