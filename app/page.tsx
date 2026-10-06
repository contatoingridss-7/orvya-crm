import { Brand, Signature } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { checkDatabase, type DbHealth } from "@/lib/supabase/health";
import { ComponentShowcase } from "./component-showcase";

// Página provisória da Fase 0. Na Fase 1 vira o redirecionamento para /login ou para a empresa.
export const dynamic = "force-dynamic";

const TABLE_LABEL: Record<string, string> = {
  companies: "Empresas",
  pipelines: "Funis",
  stages: "Etapas",
  automation_rules: "Automações",
  products: "Produtos no catálogo",
  whatsapp_numbers: "Números de WhatsApp (vagas)",
};

export default async function Home() {
  const health = await checkDatabase();

  return (
    <main className="mx-auto grid w-full max-w-[960px] gap-4 px-4 pt-6 pb-12 sm:px-7">
      <header className="flex items-center gap-3">
        <Brand />
        <div className="flex-1" />
        <ThemeToggle />
      </header>

      <div>
        <h1 className="text-2xl font-bold tracking-[-0.03em]">Base do projeto</h1>
        <p className="mt-0.5 text-[13px] text-muted">Fase 0 — conferência da conexão com o banco e dos componentes visuais.</p>
      </div>

      <Panel title="Banco de dados (Supabase)" subtitle="Projeto psewjkrpwnmrmiwwmcgw · região São Paulo">
        <DatabaseStatus health={health} />
      </Panel>

      <ComponentShowcase />

      <footer className="flex justify-center pt-4">
        <Signature />
      </footer>
    </main>
  );
}

function DatabaseStatus({ health }: { health: DbHealth }) {
  if (health.state === "offline") {
    return (
      <Notice tone="bad">
        Não foi possível falar com o Supabase: {health.message}. Confira a URL e a anon key em .env.local.
      </Notice>
    );
  }

  if (health.state === "no-schema") {
    return (
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          <Pill tone="ok">Conectado</Pill>
          <Pill tone="warn">Tabelas ainda não criadas</Pill>
        </div>
        <Notice tone="warn">
          O projeto responde, mas o banco está vazio. Rode <b>supabase/migrations/0001_init.sql</b> e depois{" "}
          <b>supabase/seed.sql</b> no SQL Editor do Supabase e recarregue esta página.
        </Notice>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Pill tone="ok">Conectado</Pill>
        <Pill tone="ok">Tabelas criadas</Pill>
        {health.counts && <Pill tone={health.counts.companies ? "ok" : "warn"}>{health.counts.companies ? "Dados iniciais carregados" : "Seed pendente"}</Pill>}
      </div>
      {health.counts ? (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Object.entries(health.counts).map(([table, count]) => (
            <div key={table} className="rounded-[10px] border border-line bg-surface-2 px-3 py-2">
              <dt className="text-[11px] text-muted">{TABLE_LABEL[table] ?? table}</dt>
              <dd className="m-0 text-base font-bold text-title tabular-nums">{count}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <Notice>
          Para conferir os dados iniciais (empresas, funis, catálogo), cole a <b>service_role key</b> em .env.local.
          Sem login, o RLS esconde tudo — é o comportamento esperado.
        </Notice>
      )}
    </div>
  );
}
