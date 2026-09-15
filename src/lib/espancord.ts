export type AppRole = "dono" | "admin" | "moderador" | "membro";

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
    (best, r) => (ROLE_RANK[r] > ROLE_RANK[best] ? r : best),
    "membro",
  );
}
