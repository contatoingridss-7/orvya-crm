import type { Metadata } from "next";
import Link from "next/link";
import { AuthFilm } from "@/components/auth-film";
import { Brand, Signature, SLOGAN } from "@/components/brand";
import { LegalFooter } from "@/components/legal-footer";
import { PlatformLogo } from "@/components/platform-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: { absolute: "Orvya · CRM com WhatsApp oficial, funil de vendas e gestão" },
  description:
    "O Orvya junta o atendimento pelo WhatsApp oficial, o funil de vendas, as tarefas, a expedição e os relatórios da sua empresa em um só lugar.",
  openGraph: {
    title: "Orvya · CRM com WhatsApp oficial",
    description: SLOGAN,
    images: ["/brand/orvya-intro-poster.jpg"],
    locale: "pt_BR",
    type: "website",
  },
};

// Mensalidade combinada com a Ingrid em 25/10/2026. A taxa de implementação não aparece em valor.
const MONTHLY_PRICE = 129;
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 });

function whatsappLink(text: string) {
  return `https://wa.me/${LEGAL.whatsapp}?text=${encodeURIComponent(text)}`;
}

const WA = {
  hello: whatsappLink("Olá! Quero conhecer o Orvya."),
  segment: whatsappLink("Olá! Quero contar como é a minha operação e ver como o Orvya se adapta a ela."),
  proposal: whatsappLink("Olá! Quero uma proposta do Orvya para a minha empresa."),
};

// Página pública de apresentação (sem login). Não usa dados do banco: nada de cliente, número ou resultado.
export default function ApresentacaoPage() {
  return (
    <div className="lp">
      <Header />
      <main>
        <Hero />
        <Solutions />
        <Features />
        <Segment />
        <Steps />
        <Integrations />
        <Plans />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="lp-head">
      <div className="lp-wrap flex h-16 items-center gap-3">
        <a href="#inicio" aria-label="Orvya, início da página">
          <Brand showSlogan={false} />
        </a>
        <nav className="ml-6 hidden items-center gap-1 lg:flex" aria-label="Seções">
          <a className="lp-nav" href="#recursos">Recursos</a>
          <a className="lp-nav" href="#como-funciona">Como funciona</a>
          <a className="lp-nav" href="#planos">Planos</a>
          <a className="lp-nav" href="#perguntas">Perguntas</a>
        </nav>
        <div className="flex-1" />
        <ThemeToggle />
        <Link href="/login" className="btn ghost hidden sm:inline-flex">
          Entrar
        </Link>
        <a href={WA.hello} target="_blank" rel="noopener" className="btn primary">
          <Icon name="chat" />
          <span className="hidden sm:inline">Falar no WhatsApp</span>
          <span className="sm:hidden">Conversar</span>
        </a>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section id="inicio" className="lp-wrap grid items-center gap-10 pt-10 pb-16 md:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:pb-24">
      <div className="grid gap-6">
        <span className="lp-eyebrow">CRM com WhatsApp oficial</span>
        <h1 className="lp-h1">
          Cada conversa no WhatsApp vira <em>venda acompanhada</em>.
        </h1>
        <p className="lp-lead">
          O Orvya junta o atendimento pelo WhatsApp oficial, o funil de vendas, as tarefas, a expedição e os relatórios em um só lugar. A
          equipe sabe quem atender agora, e a gestão enxerga onde o negócio está parando.
        </p>
        <div className="flex flex-wrap gap-3">
          <a href={WA.hello} target="_blank" rel="noopener" className="btn primary lp-btn-lg">
            <Icon name="chat" />
            Falar no WhatsApp
          </a>
          <a href="#como-funciona" className="btn lp-btn-lg">
            Ver como funciona
          </a>
        </div>
        <p className="m-0 max-w-[520px] text-[13px] leading-relaxed text-muted">
          Nasceu dentro da rotina comercial de empresas de produtos e equipamentos de saúde em Teresina (PI), e se adapta ao seu segmento.
        </p>
      </div>

      <div className="lp-film">
        <AuthFilm className="lp-film-media" minWidth={768} />
        <div className="lp-film-shade" />
        <div className="lp-float lp-float-a" aria-hidden>
          <span className="lp-dot" />
          <div>
            <b>Precisa de mim</b>
            <small>Cliente sem resposta</small>
          </div>
          <span className="pill warn ml-auto tabular-nums">05:12</span>
        </div>
        <div className="lp-float lp-float-b" aria-hidden>
          <Icon name="check" />
          <div>
            <b>Tarefa criada</b>
            <small>Retornar orçamento amanhã</small>
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionHead({ eyebrow, title, lead, center = false }: { eyebrow: string; title: React.ReactNode; lead?: string; center?: boolean }) {
  return (
    <div className={center ? "mx-auto grid max-w-[720px] gap-3 text-center" : "grid max-w-[720px] gap-3"}>
      <span className="lp-eyebrow">{eyebrow}</span>
      <h2 className="lp-h2">{title}</h2>
      {lead && <p className="lp-lead">{lead}</p>}
    </div>
  );
}

function Solutions() {
  return (
    <section id="solucoes" className="lp-section">
      <div className="lp-wrap grid gap-10">
        <SectionHead
          eyebrow="Soluções"
          title={
            <>
              Três frentes que costumam travar a venda. <em>Resolvidas juntas.</em>
            </>
          }
          lead="Atendimento, acompanhamento e gestão conversam entre si: o que acontece no WhatsApp mexe no funil, e o funil vira número para quem decide."
        />
        <div className="grid gap-5 lg:grid-cols-3">
          <article className="lp-card lp-solution">
            <ChatMock />
            <div className="grid gap-2">
              <h3>Atendimento que não deixa cliente esperando</h3>
              <p>
                WhatsApp oficial da Meta e Instagram Direct na mesma caixa de conversas, com modelos aprovados e controle da janela de 24
                horas. Cliente sem resposta há 5 minutos aparece em <b>Precisa de mim</b>, com cronômetro.
              </p>
            </div>
          </article>
          <article className="lp-card lp-solution">
            <KanbanMock />
            <div className="grid gap-2">
              <h3>Funil que lembra o que precisa ser feito</h3>
              <p>
                Kanban por funil e etapa. Ao entrar numa etapa, a tarefa nasce sozinha; lead parado vira tarefa; e tarefa atrasada sobe para o
                gestor.
              </p>
            </div>
          </article>
          <article className="lp-card lp-solution">
            <ChartMock />
            <div className="grid gap-2">
              <h3>Gestão com número de verdade</h3>
              <p>
                Relatórios por pessoa, PDF na hora e resumo semanal por e-mail. No tráfego pago, o investimento da Meta é cruzado com os leads e
                as vendas que chegaram: CPL real, custo por venda e ROAS.
              </p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

const FEATURES: Array<{ icon: IconName; title: string; text: string; soon?: boolean; tag?: string }> = [
  {
    icon: "chat",
    title: "WhatsApp e Instagram juntos",
    text: "Conversas do WhatsApp oficial e do Instagram Direct num só lugar, com menu de boas-vindas e respostas automáticas no Instagram.",
  },
  {
    icon: "clock",
    title: "Tempo de resposta à vista",
    text: "Cada conversa sem resposta ganha um cronômetro: amarelo em 5 minutos, vermelho em 15. Nada fica esquecido na fila.",
  },
  {
    icon: "columns",
    title: "Vários funis por empresa",
    text: "Varejo, institucional, locação: cada processo com as próprias etapas, campos e motivos de perda.",
  },
  {
    icon: "list",
    title: "Tarefas prontas e automações",
    text: "Regras ao entrar na etapa, quando o lead fica parado, ao entregar e com repetição, como a reposição a cada 30 dias.",
  },
  {
    icon: "refresh",
    title: "Reativação de leads parados",
    text: "Escolha quem está parado há 2, 5, 7 ou 14 dias, um modelo aprovado e veja o custo antes de enviar. O envio sai em fila.",
  },
  {
    icon: "truck",
    title: "Expedição",
    text: "Perfil próprio para quem separa, fatura e entrega: agenda de entregas e atendimentos no local, com andamento até o cliente.",
  },
  {
    icon: "box",
    title: "Catálogo com fotos",
    text: "Fotos tiradas pelo celular, importação do sistema de gestão e histórico de vendas por período.",
  },
  {
    icon: "chart",
    title: "Relatórios e e-mail semanal",
    text: "Tarefas concluídas, atrasadas e entregas por pessoa. PDF na hora e resumo no e-mail da gestão todo sábado.",
  },
  {
    icon: "users",
    title: "Multiempresa e perfis",
    text: "Administrador, gestor, vendedor e expedição: cada um vê só o que precisa. O vendedor pode ficar restrito a alguns funis.",
  },
  {
    icon: "shield",
    title: "Segurança e LGPD",
    text: "Permissões garantidas no próprio banco de dados, arquivos em armazenamento privado e cuidado redobrado com dados sensíveis.",
  },
  {
    icon: "target",
    title: "Tráfego pago ligado à venda",
    text: "Investimento da Meta e do Google cruzado com leads e vendas, alertas de criativo saturado e de custo alto, e relatório pronto para o cliente.",
    tag: "Com a gestão VÉR7ICE",
  },
  {
    icon: "cpu",
    title: "Agente de IA",
    text: "Atendimento inicial e triagem por inteligência artificial, com passagem para a equipe quando precisar.",
    soon: true,
  },
];

function Features() {
  return (
    <section id="recursos" className="lp-section">
      <div className="lp-wrap grid gap-10">
        <SectionHead
          eyebrow="Recursos"
          title="Tudo o que a rotina comercial pede, sem planilha paralela."
          lead="Do primeiro “oi” no WhatsApp até a entrega na casa do cliente, cada passo fica registrado e com dono."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <article key={f.title} className={f.soon ? "lp-card lp-feature lp-soon" : "lp-card lp-feature"}>
              <span className="lp-icon">
                <Icon name={f.icon} />
              </span>
              <h3>
                {f.title}
                {f.soon && <span className="pill ml-2 align-middle">Em breve</span>}
                {f.tag && <span className="pill ind ml-2 align-middle">{f.tag}</span>}
              </h3>
              <p>{f.text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Segment() {
  return (
    <section className="lp-section">
      <div className="lp-wrap">
        <div className="lp-card lp-segment grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:gap-12">
          <div className="grid content-start gap-4">
            <span className="lp-eyebrow">Feito para o seu segmento</span>
            <h2 className="lp-h2">
              Um CRM que entende <em>o jeito que você vende</em>.
            </h2>
            <p className="lp-lead">
              O Orvya foi construído junto com quem atende e vende todos os dias. Na operação de produtos e equipamentos de saúde, ganhou
              módulos que um CRM genérico não tem.
            </p>
            <p className="lp-lead">Na sua empresa, a gente entende a rotina e inclui o que for específico do seu negócio.</p>
            <div>
              <a href={WA.segment} target="_blank" rel="noopener" className="btn primary lp-btn-lg">
                Contar como é a minha operação
                <Icon name="arrow" />
              </a>
            </div>
          </div>
          <ul className="lp-examples">
            <li>
              <span className="lp-icon">
                <Icon name="calendar" />
              </span>
              <div>
                <b>Contratos de locação</b>
                <p>Equipamento, número de série e vencimento, com tarefa de renovação 30, 15 e 7 dias antes do fim.</p>
              </div>
            </li>
            <li>
              <span className="lp-icon">
                <Icon name="truck" />
              </span>
              <div>
                <b>Entrega agendada direto do funil</b>
                <p>Ao mover o lead para a etapa, a equipe informa data, hora e endereço, e a expedição recebe o pedido.</p>
              </div>
            </li>
            <li>
              <span className="lp-icon">
                <Icon name="refresh" />
              </span>
              <div>
                <b>Reposição de consumíveis</b>
                <p>Lembretes de troca a cada 30 e 90 dias depois da entrega, repetidos enquanto o cliente estiver ativo.</p>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  { title: "Conversa de diagnóstico", text: "Entendemos como sua equipe vende hoje: canais, etapas, produtos e onde a venda costuma travar." },
  {
    title: "Configuração",
    text: "Montamos funis, etapas, automações e catálogo do seu jeito e conectamos o número oficial do WhatsApp.",
  },
  {
    title: "Treinamento antes de começar",
    text: "A equipe aprende a usar o Orvya na rotina comercial real: atender, mover o funil, cumprir tarefas e acompanhar resultados.",
  },
  { title: "Acompanhamento", text: "Ficamos por perto no começo e ajustamos o que o dia a dia pedir." },
];

function Steps() {
  return (
    <section id="como-funciona" className="lp-section">
      <div className="lp-wrap grid gap-10">
        <SectionHead eyebrow="Como funciona" title="Do diagnóstico ao primeiro atendimento, sem sua equipe ficar sozinha." />
        <ol className="lp-steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="lp-card">
              <span className="lp-step-n">{String(i + 1).padStart(2, "0")}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const INTEGRATIONS: Array<{ name: string; text: string; soon?: boolean; logo?: "meta" | "google" }> = [
  { name: "WhatsApp Business", text: "API oficial da Meta: conversas, mídia, modelos e status de entrega." },
  { name: "Instagram Direct", text: "Mensagens do Instagram da empresa na mesma caixa de conversas, com menu de boas-vindas." },
  { name: "Meta Ads", text: "Investimento, campanhas e anúncios de clique para o WhatsApp ligados aos leads.", logo: "meta" },
  { name: "Google Ads", text: "Investimento e campanhas do Google acompanhados junto dos leads e das vendas.", logo: "google" },
  { name: "Sistema de gestão", text: "Estoque e relatórios de vendas importados (ex.: Net Use), além de planilhas CSV e Excel." },
  { name: "E-mail", text: "Relatório semanal para gestores, só com números, sem dados de clientes." },
  { name: "Formulários da Meta", text: "Leads dos formulários de anúncio do Facebook e do Instagram entrando direto no funil.", soon: true },
  { name: "API de Conversões", text: "Vendas fechadas no Orvya devolvidas à Meta para os anúncios aprenderem quem compra.", soon: true },
  { name: "Formulário do site", text: "Contato do site entrando direto no funil, com a origem marcada.", soon: true },
];

function Integrations() {
  return (
    <section id="integracoes" className="lp-section">
      <div className="lp-wrap grid gap-10">
        <SectionHead
          eyebrow="Integrações"
          title="Conectado ao que a sua empresa já usa."
          lead="Os dados chegam sozinhos ao Orvya, e cada lead mantém a origem: anúncio, WhatsApp direto ou Instagram."
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {INTEGRATIONS.map((it) => (
            <div key={it.name} className="lp-card lp-integration">
              <div className="flex items-center gap-2">
                {it.logo && <PlatformLogo platform={it.logo} size={20} />}
                <b>{it.name}</b>
                <span className={it.soon ? "pill ml-auto" : "pill ok ml-auto"}>{it.soon ? "Em breve" : "Disponível"}</span>
              </div>
              <p>{it.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const INCLUDED = [
  "WhatsApp oficial, Instagram Direct, funil, tarefas, expedição, catálogo e relatórios",
  "Configuração dos funis, etapas, automações e catálogo",
  "Treinamento da equipe antes de começar, focado no dia a dia comercial",
  "Perfis de acesso para administrador, gestor, vendedor e expedição",
];

function Plans() {
  return (
    <section id="planos" className="lp-section">
      <div className="lp-wrap grid gap-10">
        <SectionHead
          eyebrow="Planos"
          title="Implementação e mensalidade por empresa."
          lead="Um plano só, com tudo o que a equipe usa no dia a dia. O que for específico do seu segmento entra na proposta."
          center
        />
        <div className="mx-auto grid w-full max-w-[920px] gap-5 md:grid-cols-[1.15fr_1fr]">
          <div className="lp-card lp-price">
            <span className="lp-eyebrow">Orvya</span>
            <p className="lp-price-value">
              {brl.format(MONTHLY_PRICE)}
              <small>/mês por empresa</small>
            </p>
            <p className="m-0 text-[13.5px] text-muted">+ taxa simbólica de implementação, com o treinamento incluído.</p>
            <ul className="lp-checks">
              {INCLUDED.map((item) => (
                <li key={item}>
                  <Icon name="check" />
                  {item}
                </li>
              ))}
            </ul>
            <a href={WA.proposal} target="_blank" rel="noopener" className="btn primary lp-btn-lg w-full">
              Fale com a gente para uma proposta
            </a>
          </div>
          <div className="lp-card lp-module grid content-start gap-3">
            <span className="lp-icon">
              <Icon name="puzzle" />
            </span>
            <h3>Módulo do seu segmento</h3>
            <p>
              Cada negócio tem um detalhe que faz diferença: contrato, agenda, reposição, ficha técnica. Há margem para incluir o módulo
              específico do seu segmento, combinado com você na proposta.
            </p>
            <p className="text-[12.5px]">
              As mensagens de modelo do WhatsApp (enviadas fora da janela de 24 horas) são cobradas pela Meta, conforme a tabela dela.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

const FAQ: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: "Preciso de um número novo de WhatsApp?",
    a: "Nem sempre. O Orvya usa o WhatsApp oficial da Meta e, em muitos casos, o número que a empresa já usa no WhatsApp Business pode ser conectado e continuar funcionando no celular. Na conversa de diagnóstico avaliamos o melhor caminho para o seu caso.",
  },
  {
    q: "A equipe consegue usar pelo celular?",
    a: "Sim. O vendedor tem uma tela pensada para o celular, com conversas, funil, tarefas e catálogo. A expedição também trabalha pelo celular, inclusive para fotografar os produtos.",
  },
  {
    q: "Quanto custa enviar mensagens?",
    a: "Responder o cliente dentro de 24 horas da última mensagem dele não tem custo de mensagem. Fora dessa janela, só é possível enviar modelos aprovados, que a Meta cobra por mensagem. O Orvya mostra o custo estimado antes de enviar.",
  },
  {
    q: "Tenho mais de uma empresa. Funciona?",
    a: "Funciona. Cada empresa tem os próprios números de WhatsApp (até dois), funis, catálogo e equipe, com acessos separados. Quem trabalha nas duas troca de empresa com um clique.",
  },
  {
    q: "Consigo trazer meu catálogo de produtos?",
    a: "Sim. Os produtos entram por planilha (CSV ou Excel) ou pelos relatórios do sistema de gestão, e o histórico de vendas importado mostra o que mais sai em cada período.",
  },
  {
    q: "Como ficam a segurança e a LGPD?",
    a: (
      <>
        As permissões são garantidas no próprio banco de dados: cada pessoa vê só o que o perfil dela permite. Fotos e documentos ficam em
        armazenamento privado, e dados sensíveis recebem cuidado redobrado. Veja a{" "}
        <Link href="/privacidade" className="underline underline-offset-2">
          política de privacidade
        </Link>
        .
      </>
    ),
  },
  {
    q: "O Orvya tem inteligência artificial?",
    a: "A estrutura para um agente de atendimento já existe, mas ainda não está ativa. Quando chegar, vai ser opcional e com passagem para a equipe sempre que o cliente precisar de uma pessoa.",
  },
  {
    q: "Funciona para o meu segmento?",
    a: "O Orvya nasceu no comércio de produtos e equipamentos de saúde, mas a base serve para qualquer empresa que vende pelo WhatsApp. O que for específico do seu negócio entra como módulo, combinado na proposta.",
  },
];

function Faq() {
  return (
    <section id="perguntas" className="lp-section">
      <div className="lp-wrap grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
        <div className="self-start lg:sticky lg:top-24">
          <SectionHead eyebrow="Perguntas frequentes" title="Antes de conversar, o que costumam perguntar." />
        </div>
        <div className="grid content-start gap-3">
          {FAQ.map((item) => (
            <details key={item.q} className="lp-card lp-faq">
              <summary>
                {item.q}
                <Icon name="plus" />
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="lp-section">
      <div className="lp-wrap">
        <div className="lp-final">
          <div className="grid max-w-[620px] gap-4">
            <h2 className="lp-h2">Vamos conversar sobre a sua operação?</h2>
            <p className="lp-lead">Conte como sua equipe vende hoje. A gente mostra como o Orvya fica no seu dia a dia.</p>
          </div>
          <div>
            <a href={WA.hello} target="_blank" rel="noopener" className="btn primary lp-btn-lg">
              <Icon name="chat" />
              Falar no WhatsApp
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="lp-foot">
      <div className="lp-wrap grid gap-8 py-10 md:grid-cols-[1fr_auto] md:items-end">
        <div className="grid gap-4">
          <Brand />
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-[13px]" aria-label="Rodapé">
            <a href="#recursos">Recursos</a>
            <a href="#como-funciona">Como funciona</a>
            <a href="#planos">Planos</a>
            <a href="#perguntas">Perguntas</a>
            <Link href="/login">Entrar</Link>
          </nav>
        </div>
        <div className="grid justify-items-center gap-2 border-t border-line pt-6 md:justify-items-end md:border-0 md:pt-0">
          <Signature />
          <LegalFooter />
        </div>
      </div>
    </footer>
  );
}

/* Ilustrações da interface (sem dados reais: só a forma das telas) */

function ChatMock() {
  return (
    <div className="lp-mock" aria-hidden>
      <div className="lp-mock-row">
        <span className="lp-avatar" />
        <span className="lp-lines">
          <i style={{ width: "62%" }} />
          <i style={{ width: "40%" }} />
        </span>
        <span className="pill warn tabular-nums">05:12</span>
      </div>
      <div className="lp-mock-row">
        <span className="lp-avatar" />
        <span className="lp-lines">
          <i style={{ width: "54%" }} />
          <i style={{ width: "34%" }} />
        </span>
        <span className="pill bad tabular-nums">16:40</span>
      </div>
      <div className="grid gap-2 pt-1">
        <span className="lp-bubble in">Bom dia! Vocês entregam hoje?</span>
        <span className="lp-bubble out">Entregamos, sim. Me passa o endereço que eu já agendo.</span>
      </div>
    </div>
  );
}

function KanbanMock() {
  const cols = [
    { name: "Novo contato", cards: [{ pill: "bad", label: "Tarefa atrasada" }, {}] },
    { name: "Orçamento", cards: [{ pill: "warn", label: "Tarefa para hoje" }, {}] },
    { name: "Entrega agendada", cards: [{ pill: "soft", label: "Agendado" }] },
  ] as const;
  return (
    <div className="lp-mock lp-kanban" aria-hidden>
      {cols.map((c) => (
        <div key={c.name} className="lp-col">
          <small>{c.name}</small>
          {c.cards.map((card, i) => (
            <span key={i} className="lp-kcard">
              <i style={{ width: "80%" }} />
              <i style={{ width: "52%" }} />
              {"pill" in card && <span className={`pill ${card.pill === "soft" ? "lp-pill-tint" : card.pill}`}>{card.label}</span>}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function ChartMock() {
  const bars = [38, 52, 44, 66, 58, 74, 62, 86, 70, 92];
  return (
    <div className="lp-mock" aria-hidden>
      <div className="lp-bars">
        {bars.map((h, i) => (
          <span key={i} style={{ height: `${h}%` }} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {["CPL real", "Custo por venda", "ROAS"].map((k) => (
          <span key={k} className="lp-kpi">
            <small>{k}</small>
            <i />
          </span>
        ))}
      </div>
    </div>
  );
}

/* Ícones de traço (sem ícones médicos, pela identidade VÉR7ICE) */

type IconName =
  | "chat"
  | "columns"
  | "list"
  | "refresh"
  | "truck"
  | "box"
  | "chart"
  | "users"
  | "shield"
  | "cpu"
  | "check"
  | "arrow"
  | "calendar"
  | "puzzle"
  | "plus"
  | "clock"
  | "target";

const ICONS: Record<IconName, string> = {
  chat: "M21 12a8.5 8.5 0 0 1-12.4 7.5L3.5 21l1.5-4.6A8.5 8.5 0 1 1 21 12Z",
  columns: "M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z",
  list: "M10 6h10M10 12h10M10 18h10M4 6l1.2 1.2L7.5 5M4 12l1.2 1.2L7.5 11M4 18l1.2 1.2L7.5 17",
  refresh: "M20 11A8 8 0 0 0 5.6 7M4 3.5V8h4.5M4 13a8 8 0 0 0 14.4 4M20 20.5V16h-4.5",
  truck: "M2.5 6h11v10h-11zM13.5 9.5h4l3 3V16h-7M5 18.5a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0M15.5 18.5a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0",
  box: "M21 7.5 12 3 3 7.5v9L12 21l9-4.5v-9ZM3 7.5l9 4.5 9-4.5M12 12v9",
  chart: "M3 20h18M6.5 16.5v-5M11.5 16.5V7M16.5 16.5V10",
  users:
    "M15.5 19v-1a4 4 0 0 0-4-4h-5a4 4 0 0 0-4 4v1M9 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21.5 19v-1a4 4 0 0 0-3-3.9M15.5 3.6a3.5 3.5 0 0 1 0 6.8",
  shield: "M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3ZM9 12l2 2 4-4",
  cpu: "M7.5 7.5h9v9h-9zM4 10h3.5M4 14h3.5M16.5 10H20M16.5 14H20M10 4v3.5M14 4v3.5M10 16.5V20M14 16.5V20",
  check: "M5 12.5l4.5 4.5L19 7.5",
  arrow: "M5 12h14M13 6l6 6-6 6",
  calendar: "M4 6.5h16V20H4zM4 10.5h16M8.5 3.5v5M15.5 3.5v5",
  puzzle:
    "M10 4.5a2 2 0 1 1 4 0V6h4v4h-1.5a2 2 0 1 0 0 4H18v4h-4v-1.5a2 2 0 1 0-4 0V18H6v-4h1.5a2 2 0 1 0 0-4H6V6h4V4.5Z",
  plus: "M12 5v14M5 12h14",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.5V12l3 2",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 12.01V12",
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg className="lp-svg" viewBox="0 0 24 24" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}
