import type { Metadata } from "next";
import Link from "next/link";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { BrandMark, Signature } from "@/components/brand";
import { ThemeSync, ThemeToggle } from "@/components/theme-toggle";
import { Pill } from "@/components/ui/pill";
import { homeSection, ROLE_LABEL } from "@/lib/auth/roles";
import { requireViewer, type CompanyAccess } from "@/lib/auth/viewer";
import { TIMEZONE } from "@/lib/format";
import { greeting } from "@/lib/greeting";
import { firstName, monogram } from "@/lib/names";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Início" };
export const dynamic = "force-dynamic";

type Stats = { tasks: number; waiting: number } | null;

/** Resumo de cada empresa para quem entra: as tarefas da pessoa até hoje e as conversas aguardando. */
async function companyStats(company: CompanyAccess, userId: string): Promise<Stats> {
  if (company.role === "logistica") return null;
  const supabase = await createClient();
  const endOfToday = fromZonedTime(`${formatInTimeZone(new Date(), TIMEZONE, "yyyy-MM-dd")}T23:59:59`, TIMEZONE).toISOString();
  const [tasks, waiting] = await Promise.all([
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("company_id", company.id)
      .eq("owner_id", userId)
      .is("done_at", null)
      .lte("due_at", endOfToday),
    // O RLS já limita ao que a pessoa vê (vendedor: as dele e a fila).
    supabase.from("conversations").select("id", { count: "exact", head: true }).eq("company_id", company.id).eq("last_direction", "in"),
  ]);
  return { tasks: tasks.count ?? 0, waiting: waiting.count ?? 0 };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Tela de entrada: saudação pelo nome e pelo dia da semana, e a escolha da empresa.
 * Todos passam por aqui (mesmo quem tem uma empresa só): é o "bom dia" do Orvya.
 */
export default async function Home() {
  const viewer = await requireViewer();
  const g = greeting();
  const stats = await Promise.all(viewer.companies.map((c) => companyStats(c, viewer.id)));
  const name = firstName(viewer.fullName);

  return (
    <div className="welcome">
      <ThemeSync theme={viewer.theme} />
      <header className="mx-auto flex w-full max-w-[1080px] items-center gap-3 px-5 pt-6 sm:px-8">
        <BrandMark size={26} />
        <strong className="font-title text-[18px] font-semibold tracking-[-0.03em] text-title">Orvya</strong>
        <div className="flex-1" />
        <ThemeToggle persist />
        <form action="/auth/sair" method="post">
          <button type="submit" className="btn ghost sm">
            Sair
          </button>
        </form>
      </header>

      <main className="mx-auto grid w-full max-w-[1080px] flex-1 content-center gap-10 px-5 py-12 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-16">
        <section className="grid gap-4">
          <span className="eyebrow" suppressHydrationWarning>
            {g.date}
          </span>
          <h1 suppressHydrationWarning>
            {g.hello}, <em>{name}</em>.
          </h1>
          <p className="m-0 max-w-[460px] text-[16px] leading-relaxed text-muted" suppressHydrationWarning>
            {g.line}
          </p>
        </section>

        <section className="grid gap-3" aria-label="Empresas">
          <span className="eyebrow">{viewer.companies.length > 1 ? "Escolha a empresa" : "Sua empresa"}</span>
          {viewer.companies.length === 0 ? (
            <div className="panel">
              <p className="m-0 text-[13.5px] text-muted">Seu usuário ainda não foi ligado a nenhuma empresa. Peça ao administrador para incluir você.</p>
            </div>
          ) : (
            viewer.companies.map((c, i) => <CompanyCard key={c.slug} company={c} stats={stats[i] ?? null} />)
          )}
        </section>
      </main>

      <footer className="flex justify-center px-5 pb-8">
        <Signature />
      </footer>
    </div>
  );
}

function CompanyCard({ company: c, stats }: { company: CompanyAccess; stats: Stats }) {
  return (
    <Link href={`/${c.slug}/${homeSection(c.role)}`} className="co-card">
      <span className="mono" data-co={c.slug}>
        {monogram(c)}
      </span>
      <span className="min-w-0">
        <b>{c.name}</b>
        {c.segment && <small className="truncate">{c.segment}</small>}
        <span className="co-stats">
          <Pill>{ROLE_LABEL[c.role]}</Pill>
          {stats && (
            <>
              <Pill tone={stats.tasks ? "warn" : undefined}>{stats.tasks ? plural(stats.tasks, "tarefa para hoje", "tarefas para hoje") : "Tarefas em dia"}</Pill>
              {stats.waiting > 0 && <Pill tone="ind">{plural(stats.waiting, "conversa aguardando", "conversas aguardando")}</Pill>}
            </>
          )}
        </span>
      </span>
      <span className="arrow" aria-hidden>
        <svg viewBox="0 0 24 24">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
    </Link>
  );
}
