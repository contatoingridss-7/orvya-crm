import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand, Signature } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { homeSection, ROLE_LABEL } from "@/lib/auth/roles";
import { requireViewer } from "@/lib/auth/viewer";
import { firstName, monogram } from "@/lib/names";

/**
 * Depois do login: quem tem uma empresa vai direto para ela;
 * administrador e quem tem mais de uma escolhem aqui.
 */
export default async function Home() {
  const viewer = await requireViewer();
  const [only] = viewer.companies;

  if (viewer.companies.length === 1 && only && !viewer.isAdmin) {
    redirect(`/${only.slug}/${homeSection(only.role)}`);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col justify-center gap-6 px-4 py-10">
      <header className="flex items-center gap-3">
        <Brand />
        <div className="flex-1" />
        <ThemeToggle persist />
      </header>

      <section className="panel grid gap-4 !p-6">
        <div>
          <h1 className="text-[22px] font-bold tracking-[-0.03em]">Olá, {firstName(viewer.fullName)}</h1>
          <p className="mt-1 text-[13px] text-muted">
            {viewer.companies.length ? "Escolha a empresa para continuar." : "Seu usuário ainda não foi ligado a nenhuma empresa."}
          </p>
        </div>

        {viewer.companies.length > 0 ? (
          <div className="grid gap-2">
            {viewer.companies.map((c) => (
              <Link key={c.slug} href={`/${c.slug}/${homeSection(c.role)}`} className="co-btn !p-3.5">
                <span className="mono" data-co={c.slug}>
                  {monogram(c)}
                </span>
                <span className="min-w-0 flex-1">
                  <b>{c.name}</b>
                  {c.segment && <small>{c.segment}</small>}
                </span>
                <span className="pill">{ROLE_LABEL[c.role]}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="empty m-0">Peça ao administrador para incluir você em uma empresa.</p>
        )}

        <form action="/auth/sair" method="post" className="justify-self-center">
          <button type="submit" className="btn ghost sm">
            Sair
          </button>
        </form>
      </section>

      <div className="flex justify-center">
        <Signature />
      </div>
    </main>
  );
}
