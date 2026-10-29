"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

// Demonstração em loop da operação no Orvya, desenhada em código (não é gravação): login, tela
// inicial, conversa no WhatsApp e lead andando no funil. Tudo fictício: a "Clínica Bem Viver" e
// as pessoas não existem. Palco fixo de 960 × 600, escalado para a largura disponível.

const W = 960;
const H = 600;

type Scene = "login" | "home" | "inbox" | "funnel";
type Temp = "morno" | "quente";
type CardAt = "novo" | "drag" | "agendado";

type State = {
  scene: Scene;
  cx: number;
  cy: number;
  cd: number; // duração do movimento do cursor (ms)
  press: boolean;
  email: string;
  pwd: number;
  open: boolean;
  msgs: number;
  composer: string;
  typingIn: boolean;
  answered: boolean;
  temp: Temp;
  card: CardAt;
  toast: boolean;
  fade: boolean;
};

const START: State = {
  scene: "login",
  cx: 720,
  cy: 520,
  cd: 0,
  press: false,
  email: "",
  pwd: 0,
  open: false,
  msgs: 0,
  composer: "",
  typingIn: false,
  answered: false,
  temp: "morno",
  card: "novo",
  toast: false,
  fade: true,
};

const CHAT: { dir: "in" | "out"; text: string }[] = [
  { dir: "in", text: "Oi! Vocês atendem sábado?" },
  { dir: "out", text: "Atendemos, sim: sábado das 8h às 12h." },
  { dir: "in", text: "Tem vaga para limpeza de pele essa semana?" },
  { dir: "out", text: "Tenho quinta às 15h ou sexta às 10h. Qual fica melhor?" },
  { dir: "in", text: "Quinta às 15h, por favor." },
];

type Step = { t: number; patch: Partial<State> };

/** Roteiro: cada passo muda o estado num instante (ms desde o início do ciclo). */
function buildTimeline() {
  const steps: Step[] = [];
  let t = 0;
  const at = (patch: Partial<State>) => steps.push({ t, patch });
  const wait = (ms: number) => (t += ms);
  const move = (cx: number, cy: number, cd = 700) => {
    at({ cx, cy, cd });
    wait(cd + 60);
  };
  const click = () => {
    at({ press: true });
    wait(170);
    at({ press: false });
    wait(160);
  };
  const type = (text: string, key: "email" | "composer", speed = 45) => {
    for (let i = 1; i <= text.length; i++) {
      at({ [key]: text.slice(0, i) } as Partial<State>);
      wait(speed);
    }
  };

  // Login
  at({ ...START, fade: false });
  wait(500);
  move(480, 303, 800);
  click();
  type("ana@bemviver.com.br", "email", 55);
  move(480, 380, 380);
  click();
  for (let i = 1; i <= 8; i++) {
    at({ pwd: i });
    wait(70);
  }
  move(480, 439, 450);
  click();
  wait(250);

  // Tela inicial
  at({ scene: "home" });
  wait(900);
  move(310, 262, 900);
  wait(250);
  click();
  wait(200);

  // Conversas
  at({ scene: "inbox", msgs: 0 });
  wait(700);
  at({ msgs: 1 });
  wait(900);
  move(311, 122, 800);
  click();
  at({ open: true });
  wait(400);
  move(700, 563, 700);
  click();
  type(CHAT[1]!.text, "composer", 38);
  move(919, 563, 350);
  click();
  at({ composer: "", msgs: 2, answered: true });
  wait(900);
  at({ typingIn: true });
  wait(1300);
  at({ typingIn: false, msgs: 3 });
  wait(900);
  move(700, 563, 500);
  click();
  type(CHAT[3]!.text, "composer", 34);
  move(919, 563, 350);
  click();
  at({ composer: "", msgs: 4 });
  wait(800);
  at({ typingIn: true });
  wait(1100);
  at({ typingIn: false, msgs: 5 });
  wait(1500);

  // Funil
  move(88, 155, 800);
  click();
  at({ scene: "funnel" });
  wait(900);
  move(240, 190, 900);
  click();
  at({ temp: "quente" });
  wait(900);
  move(282, 145, 450);
  at({ press: true, card: "drag" });
  wait(200);
  move(663, 266, 1200);
  at({ press: false, card: "agendado" });
  wait(500);
  at({ toast: true });
  wait(3200);

  // Fim do ciclo
  at({ fade: true });
  wait(700);
  return { steps, total: t };
}

function stateAt(steps: Step[], elapsed: number): State {
  let s = START;
  for (const step of steps) {
    if (step.t > elapsed) break;
    s = { ...s, ...step.patch };
  }
  return s;
}

export function DemoReel({ className }: { className?: string }) {
  const { steps, total } = useMemo(buildTimeline, []);
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  // Sem movimento (preferência do aparelho): fica parado na conversa respondida.
  const [state, setState] = useState<State>(() => stateAt(steps, 24_000));

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let visible = true;
    let elapsed = 0;
    let last = performance.now();
    let idx = -1;
    let raf = 0;
    const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      // Fora da tela ou em outra aba: o relógio para (não gasta processamento à toa).
      if (visible && !document.hidden) {
        elapsed = (elapsed + Math.min(dt, 500)) % total;
        let i = -1;
        for (let k = 0; k < steps.length && steps[k]!.t <= elapsed; k++) i = k;
        if (i !== idx) {
          idx = i;
          setState(stateAt(steps, elapsed));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [steps, total]);

  return (
    <div ref={box} className={`demo ${className ?? ""}`} aria-label="Demonstração animada do Orvya com dados fictícios" role="img">
      <div className="demo-stage" style={{ width: W, height: H, transform: `scale(${scale})` }} aria-hidden>
        <div className="demo-chrome">
          <span />
          <span />
          <span />
          <em>orvya.ver7ice.com.br</em>
        </div>
        <div className="demo-body">
          {state.scene === "login" && <Login s={state} />}
          {state.scene === "home" && <Home />}
          {(state.scene === "inbox" || state.scene === "funnel") && <Shell s={state} />}
        </div>
        {state.toast && state.scene === "funnel" && (
          <div className="demo-toast">
            <Check /> <span>Tarefa criada: confirmar presença na quarta</span>
          </div>
        )}
        {state.card === "drag" && state.scene === "funnel" && (
          <div className="demo-card hot demo-dragging" style={{ transform: `translate(${state.cx - 90}px, ${state.cy - 24}px) rotate(-2deg)`, transitionDuration: `${state.cd}ms` }}>
            <b>Mariana Souza</b>
            <small>Limpeza de pele</small>
            <i className="demo-temp quente">Quente</i>
          </div>
        )}
        <Cursor s={state} />
        <div className="demo-fade" style={{ opacity: state.fade ? 1 : 0 }} />
      </div>
    </div>
  );
}

function Cursor({ s }: { s: State }) {
  const style: CSSProperties = { transform: `translate(${s.cx}px, ${s.cy}px)`, transitionDuration: `${s.cd}ms` };
  return (
    <div className="demo-cursor" style={style}>
      {s.press && <span className="demo-ripple" />}
      <svg width="22" height="26" viewBox="0 0 22 26" style={{ transform: s.press ? "scale(0.9)" : undefined }}>
        <path d="M2 2 L2 21 L7.2 16.4 L10.6 24 L14 22.5 L10.7 15 L18 15 Z" fill="#F4F2ED" stroke="#0B0D0F" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size * 1.04} viewBox="0 0 100 104" className="demo-mark">
      <path d="M6 7 L50 97 L94 7" />
      <path d="M23 7 L50 60 L77 7" />
      <path d="M40.5 7 L50 27 L59.5 7" className="v" />
    </svg>
  );
}

function Login({ s }: { s: State }) {
  return (
    <div className="demo-login">
      <div className="demo-login-card">
        <div className="flex items-center gap-2.5">
          <Mark size={24} />
          <b className="demo-brand">Orvya</b>
        </div>
        <h4>Entrar</h4>
        <label>
          E-mail
          <span className="demo-input">
            {s.email}
            {s.pwd === 0 && s.email && <i className="demo-caret" />}
          </span>
        </label>
        <label>
          Senha
          <span className="demo-input">{"•".repeat(s.pwd)}</span>
        </label>
        <span className="demo-btn" style={{ transform: s.press && s.pwd === 8 ? "scale(0.98)" : undefined }}>
          Entrar
        </span>
      </div>
    </div>
  );
}

function Home() {
  return (
    <div className="demo-home">
      <p className="demo-muted">Quinta-feira</p>
      <h3>Boa tarde, Ana</h3>
      <div className="demo-home-grid">
        <div className="demo-company hl">
          <b>Clínica Bem Viver</b>
          <span>3 conversas esperando resposta</span>
          <span>12 leads em aberto · 4 tarefas hoje</span>
        </div>
        <div className="demo-company">
          <b>Ótica Visão Clara</b>
          <span>1 conversa esperando resposta</span>
          <span>5 leads em aberto · 2 tarefas hoje</span>
        </div>
      </div>
    </div>
  );
}

const NAV: { label: string; key?: Scene }[] = [{ label: "Painel" }, { label: "Funil", key: "funnel" }, { label: "Conversas", key: "inbox" }, { label: "Tarefas" }, { label: "Catálogo" }];

function Shell({ s }: { s: State }) {
  return (
    <div className="demo-shell">
      <aside className="demo-side">
        <div className="flex items-center gap-2 px-3.5 pt-4 pb-5">
          <Mark size={20} />
          <b className="demo-brand text-[17px]">Orvya</b>
        </div>
        {NAV.map((n) => (
          <span key={n.label} className={`demo-nav ${n.key === s.scene ? "on" : ""}`}>
            {n.label}
            {n.label === "Conversas" && !s.answered && <i className="demo-badge">3</i>}
          </span>
        ))}
        <span className="demo-side-co">Clínica Bem Viver</span>
      </aside>
      {s.scene === "inbox" ? <Inbox s={s} /> : <Funnel s={s} />}
    </div>
  );
}

function Inbox({ s }: { s: State }) {
  const open = s.open;
  const list = [
    { name: "Mariana Souza", last: s.msgs >= 1 ? CHAT[Math.min(s.msgs, 5) - 1]!.text : "Oi! Vocês atendem sábado?", timer: s.answered ? null : "05:12", on: open },
    { name: "Juliana Reis", last: "Qual o valor da avaliação?", timer: "01:40" },
    { name: "Carlos Lima", last: "Obrigado, até amanhã!", timer: null },
    { name: "Renata Dias", last: "Confirmado para sexta.", timer: null },
  ];
  return (
    <div className="demo-inbox">
      <div className="demo-list">
        <div className="demo-list-head">Conversas</div>
        {list.map((c) => (
          <div key={c.name} className={`demo-conv ${c.on ? "on" : ""}`}>
            <span className="demo-avatar">{c.name.slice(0, 1)}</span>
            <span className="min-w-0 flex-1">
              <b>{c.name}</b>
              <small>{c.last}</small>
            </span>
            {c.timer && <i className="demo-timer">{c.timer}</i>}
          </div>
        ))}
      </div>
      <div className="demo-chat">
        {open ? (
          <>
            <div className="demo-chat-head">
              <span className="demo-avatar">M</span>
              <span>
                <b>Mariana Souza</b>
                <small>WhatsApp · veio do anúncio “Limpeza de pele”</small>
              </span>
            </div>
            <div className="demo-msgs">
              {CHAT.slice(0, s.msgs).map((m, i) => (
                <span key={i} className={`demo-bubble ${m.dir}`}>
                  {m.text}
                </span>
              ))}
              {s.typingIn && (
                <span className="demo-bubble in demo-dots">
                  <i />
                  <i />
                  <i />
                </span>
              )}
            </div>
            <div className="demo-composer">
              <span className={s.composer ? "" : "demo-muted"}>{s.composer || "Escreva uma mensagem"}</span>
              <i className="demo-send">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 20.5 21 12 3 3.5 5.5 12 3 20.5Zm2.5-8.5H13" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                </svg>
              </i>
            </div>
          </>
        ) : (
          <div className="demo-empty">Escolha uma conversa</div>
        )}
      </div>
    </div>
  );
}

const COLS = ["Novo contato", "Qualificado", "Agendado", "Compareceu"] as const;

function Funnel({ s }: { s: State }) {
  const mariana = (
    <div className="demo-card hot" key="mariana">
      <b>Mariana Souza</b>
      <small>Limpeza de pele</small>
      <span className="flex items-center gap-1.5">
        <i className={`demo-temp ${s.temp}`}>{s.temp === "quente" ? "Quente" : "Morno"}</i>
        {s.card === "agendado" && <i className="demo-temp sched">Qui, 15h</i>}
      </span>
    </div>
  );
  const cards: Record<(typeof COLS)[number], React.ReactNode[]> = {
    "Novo contato": [
      s.card === "novo" ? mariana : null,
      <Card key="p" name="Pedro Alves" what="Avaliação facial" temp="Morno" />,
      <Card key="t" name="Tiago Nunes" what="Retorno de orçamento" temp="Frio" />,
    ],
    Qualificado: [<Card key="j" name="Juliana Reis" what="Peeling · orçamento" temp="Quente" />, <Card key="b" name="Bruna Melo" what="Drenagem · 5 sessões" temp="Morno" />],
    Agendado: [<Card key="r" name="Renata Dias" what="Avaliação · sex 9h" temp="Quente" />, s.card === "agendado" ? mariana : null],
    Compareceu: [<Card key="l" name="Lucas Moraes" what="Pacote fechado" temp="Ganho" />],
  };
  return (
    <div className="demo-funnel">
      <div className="demo-funnel-head">
        <b>Funil · Atendimento</b>
        <small>12 leads em aberto</small>
      </div>
      <div className="demo-cols">
        {COLS.map((c) => (
          <div key={c} className={`demo-col ${s.card === "drag" && c === "Agendado" ? "drop" : ""}`}>
            <small>{c}</small>
            {cards[c]}
          </div>
        ))}
      </div>
    </div>
  );
}

function Card({ name, what, temp }: { name: string; what: string; temp: string }) {
  return (
    <div className="demo-card">
      <b>{name}</b>
      <small>{what}</small>
      <i className={`demo-temp ${temp.toLowerCase()}`}>{temp}</i>
    </div>
  );
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
