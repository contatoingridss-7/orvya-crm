import type { Metadata } from "next";
import Link from "next/link";
import { Brand, Signature } from "@/components/brand";
import { LegalFooter } from "@/components/legal-footer";
import { ThemeToggle } from "@/components/theme-toggle";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Política de privacidade",
  description: "Como o Orvya trata os dados pessoais de clientes e usuários, conforme a LGPD.",
};

const UPDATED_AT = "13 de outubro de 2026";

// Página pública (sem login): exigida pela Meta para o app do WhatsApp e pela LGPD.
export default function PrivacidadePage() {
  return (
    <div className="min-h-dvh px-4 pt-6 pb-12 sm:px-7">
      <header className="mx-auto flex w-full max-w-[760px] items-center gap-3">
        <Link href="/login" aria-label="Ir para o Orvya">
          <Brand showSlogan={false} />
        </Link>
        <div className="flex-1" />
        <ThemeToggle />
      </header>

      <article className="legal mx-auto mt-8 grid w-full max-w-[760px] gap-7">
        <div className="grid gap-2">
          <h1 className="text-[clamp(26px,5vw,34px)] font-bold tracking-[-0.03em]">Política de privacidade</h1>
          <p className="text-muted">Última atualização: {UPDATED_AT}</p>
        </div>

        <section>
          <h2>1. Sobre o Orvya</h2>
          <p>
            O Orvya é um sistema de gestão de relacionamento com clientes (CRM) com atendimento pelo WhatsApp, oferecido pela {LEGAL.brand},
            marca de {LEGAL.owner}, CNPJ {LEGAL.cnpj}, com sede em {LEGAL.city}.
          </p>
          <p>
            O Orvya é usado por empresas clientes (por exemplo, lojas e fornecedores de produtos e equipamentos de saúde) para organizar o
            atendimento, os orçamentos, as vendas e as locações para os clientes delas.
          </p>
        </section>

        <section>
          <h2>2. Quem decide sobre os seus dados</h2>
          <p>
            Pela Lei Geral de Proteção de Dados (LGPD, Lei nº 13.709/2018), a <b>empresa com quem você conversa</b> é a controladora dos seus
            dados: é ela quem decide para que eles são usados. A {LEGAL.brand} é a <b>operadora</b>: guarda e processa os dados em nome dessa
            empresa, seguindo as instruções dela e esta política.
          </p>
        </section>

        <section>
          <h2>3. Quais dados tratamos</h2>
          <ul>
            <li>
              <b>Dados de contato:</b> nome, número de telefone do WhatsApp, e-mail, nome da instituição e endereço de entrega, quando
              informados.
            </li>
            <li>
              <b>Conversas pelo WhatsApp:</b> mensagens trocadas com a empresa, fotos, áudios e documentos enviados, e a situação de entrega
              e leitura das mensagens.
            </li>
            <li>
              <b>Histórico comercial:</b> produtos de interesse, orçamentos, compras, contratos de locação, tarefas e anotações da equipe.
            </li>
            <li>
              <b>Dados de saúde informados por você:</b> por exemplo, receita médica ou a condição de quem vai usar o equipamento. São dados
              sensíveis e só são usados para atender o seu pedido.
            </li>
            <li>
              <b>Origem do contato:</b> se você chegou por um anúncio (Facebook, Instagram ou Google) ou pelo site, para a empresa saber quais
              campanhas funcionam.
            </li>
            <li>
              <b>Usuários do sistema:</b> nome e e-mail das pessoas das empresas que usam o Orvya.
            </li>
          </ul>
        </section>

        <section>
          <h2>4. Para que usamos os dados</h2>
          <ul>
            <li>Responder às suas mensagens e atender o que você pediu.</li>
            <li>Preparar orçamentos, registrar vendas e locações e acompanhar entregas e contratos.</li>
            <li>Organizar o trabalho da equipe da empresa (responsável pelo atendimento, tarefas, histórico).</li>
            <li>Enviar avisos sobre o seu pedido ou contrato e, quando permitido, ofertas da empresa.</li>
            <li>Medir os resultados de anúncios e campanhas da empresa.</li>
          </ul>
          <p>
            O tratamento se baseia na execução de contrato e em procedimentos preliminares feitos a seu pedido, no legítimo interesse da
            empresa em atender e acompanhar os seus clientes e, para dados de saúde, na necessidade de fornecer o produto ou o equipamento
            solicitado. Os dados não são vendidos.
          </p>
        </section>

        <section>
          <h2>5. Com quem os dados são compartilhados</h2>
          <p>Somente com os serviços necessários para o Orvya funcionar:</p>
          <ul>
            <li>
              <b>Meta (WhatsApp Business):</b> para enviar e receber as mensagens.
            </li>
            <li>
              <b>Supabase:</b> banco de dados e armazenamento de arquivos, com servidores em São Paulo.
            </li>
            <li>
              <b>Vercel:</b> hospedagem do sistema.
            </li>
            <li>
              <b>Anthropic:</b> somente se a empresa ativar o atendimento automatizado por inteligência artificial, para gerar as respostas.
            </li>
          </ul>
          <p>Os dados também podem ser fornecidos a autoridades quando a lei exigir.</p>
        </section>

        <section>
          <h2>6. Segurança e tempo de guarda</h2>
          <p>
            O acesso é restrito por perfil: cada pessoa da empresa vê apenas o que a função dela permite. As conexões são criptografadas
            (HTTPS), e arquivos como fotos e receitas ficam em armazenamento privado, acessível apenas por links temporários.
          </p>
          <p>
            Os dados são guardados enquanto houver relação comercial com a empresa e pelos prazos exigidos em lei. Depois disso, são excluídos
            ou anonimizados.
          </p>
        </section>

        <section id="direitos">
          <h2>7. Seus direitos</h2>
          <p>
            Você pode pedir a confirmação de que tratamos seus dados, o acesso a eles, a correção de dados errados, a exclusão, a portabilidade
            e informações sobre com quem foram compartilhados. Também pode retirar um consentimento dado e se opor a mensagens de oferta.
          </p>
        </section>

        <section id="exclusao">
          <h2>8. Como pedir a exclusão dos seus dados</h2>
          <ol>
            <li>
              Envie um e-mail para <b>{LEGAL.email}</b> com o assunto “Exclusão de dados”.
            </li>
            <li>Informe o número de telefone do WhatsApp usado nas conversas e o nome da empresa com quem você falou.</li>
            <li>Podemos pedir uma confirmação de identidade antes de excluir.</li>
          </ol>
          <p>
            Respondemos em até 15 dias. Alguns dados podem ser mantidos quando a lei obrigar (por exemplo, registros fiscais de uma compra). Você
            também pode fazer o pedido diretamente à empresa com quem conversou.
          </p>
        </section>

        <section>
          <h2>9. Contato</h2>
          <p>
            Dúvidas sobre esta política ou sobre os seus dados: <b>{LEGAL.email}</b>.
          </p>
          <p>Esta política pode ser atualizada. A data da última atualização fica no topo da página.</p>
        </section>

        <div className="grid justify-items-center gap-2 border-t border-line pt-6">
          <Signature />
          <LegalFooter />
        </div>
      </article>
    </div>
  );
}
