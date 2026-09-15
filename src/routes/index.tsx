import { createFileRoute, Link } from "@tanstack/react-router";
import { MessagesSquare, ShieldCheck, Video } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Espancord — seu servidor de conversa, voz e cargos" },
      {
        name: "description",
        content:
          "Entre no Espancord com Google ou e-mail, converse em canais, receba seu cargo e acesse as salas liberadas para você.",
      },
      { property: "og:title", content: "Espancord — seu servidor de conversa" },
      {
        property: "og:description",
        content:
          "Canais de texto, cargos e salas privadas. Entre pelo link e participe em segundos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background font-sans text-foreground">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[32rem] w-[32rem] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-96 w-96 rounded-full bg-accent/15 blur-[120px]" />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span className="font-display text-xl font-bold tracking-widest text-primary">
          ESPANCORD
        </span>
        <Link
          to="/auth"
          className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary"
        >
          Entrar
        </Link>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-10">
        <h1 className="font-display max-w-3xl text-5xl font-bold leading-tight tracking-tight md:text-6xl">
          A mesa é sua.{" "}
          <span className="text-primary">As green são nossas.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Deixe o link na sua bio. A galera entra com Google ou e-mail, recebe o
          cargo e já acompanha os tips, as odds e as calls ao vivo.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            to="/auth"
            className="rounded-md bg-primary px-6 py-3 font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5"
          >
            Entrar no servidor
          </Link>
          <a
            href="#recursos"
            className="rounded-md border border-border px-6 py-3 font-medium transition-colors hover:bg-secondary"
          >
            Ver o que tem dentro
          </a>
        </div>

        <section id="recursos" className="mt-24 grid gap-5 md:grid-cols-3">
          {[
            {
              icon: MessagesSquare,
              title: "Canais de tips",
              text: "Canais em tempo real para entradas, odds e resultados do dia.",
            },
            {
              icon: ShieldCheck,
              title: "Cargos e VIP",
              text: "Dê cargos e libere as salas VIP só para quem você escolher.",
            },
            {
              icon: Video,
              title: "Calls ao vivo",
              text: "Áudio, câmera e transmissão de tela para mostrar a banca e as apostas.",
            },
          ].map(({ icon: Icon, title, text }) => (
            <div
              key={title}
              className="rounded-xl border border-border bg-card p-6"
            >
              <Icon className="h-6 w-6 text-primary" />
              <h2 className="font-display mt-4 text-lg font-semibold">{title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{text}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
