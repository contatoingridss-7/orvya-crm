import { Brand, Signature, Wordmark } from "@/components/brand";
import { AuthFilm } from "@/components/auth-film";
import { LegalFooter } from "@/components/legal-footer";

/**
 * Login, recuperação e redefinição de senha: sempre escuras, com a luz e o grão da VÉR7ICE.
 * Desktop: à esquerda o filme da marca (toca uma vez e para no símbolo) e o slogan; à direita o formulário.
 * Celular: só a marca e o formulário (o vídeo não carrega).
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-theme="dark" className="auth-screen auth-split">
      <aside className="auth-hero" aria-hidden>
        <AuthFilm />
        <div className="auth-shade" />
        <div className="auth-copy">
          <span className="flex items-center gap-2 text-[#89929c]">
            <Wordmark className="text-[15px]" />
            <span className="eyebrow !text-[#89929c]">Orvya</span>
          </span>
          <p className="auth-slogan">
            Conexões inteligentes.
            <br />
            <em>Resultados integrados.</em>
          </p>
          <p className="m-0 max-w-[420px] text-[14.5px] leading-relaxed text-[#89929c]">
            WhatsApp oficial, funil de vendas, tarefas e expedição em um só lugar.
          </p>
        </div>
      </aside>

      <main className="mx-auto flex min-h-dvh w-full max-w-[400px] flex-col justify-center gap-7 px-4 py-10">
        <div className="flex justify-center">
          <Brand />
        </div>
        <div className="panel grid gap-4 !p-6">{children}</div>
        <div className="grid justify-items-center gap-2">
          <Signature />
          <LegalFooter />
        </div>
      </main>
    </div>
  );
}
