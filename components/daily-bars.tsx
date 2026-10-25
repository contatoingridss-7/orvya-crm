"use client";

import { useState, type ReactNode } from "react";

export type BarPoint = { date: string; value: number };

const W = 640;
const H = 150;
const PAD = { top: 18, right: 8, bottom: 22, left: 8 };
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Até 14 dias, todas as datas no eixo; acima disso, espaçadas (sempre com a primeira e a última). */
const ALL_TICKS_MAX = 14;
/** Rótulo de valor em cada coluna só em períodos curtos (7 dias é o reporte comum). */
const VALUE_LABELS_MAX = 10;

function tickIndexes(n: number): number[] {
  if (n <= 1) return [0];
  if (n <= ALL_TICKS_MAX) return Array.from({ length: n }, (_, i) => i);
  const step = Math.ceil(n / 8);
  const out: number[] = [];
  for (let i = 0; i < n; i += step) out.push(i);
  if (n - 1 - out[out.length - 1]! < step / 2) out[out.length - 1] = n - 1;
  else out.push(n - 1);
  return out;
}

/** Eixo, área de passar o mouse, datas e tabela: o mesmo para barras e linha, alinhados pela data. */
function DailyFrame({
  title,
  points,
  format,
  summary,
  children,
}: {
  title: string;
  points: BarPoint[];
  format: (v: number) => string;
  summary: ReactNode;
  children: (ctx: { hover: number | null; slot: number; innerH: number; setHover: (i: number | null) => void }) => ReactNode;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / Math.max(1, points.length);
  const ticks = tickIndexes(points.length);
  const spaced = points.length > ALL_TICKS_MAX;
  const h = hover !== null ? points[hover] : null;
  const total = points.reduce((s, p) => s + p.value, 0);

  return (
    <figure className="m-0 grid gap-1.5">
      <figcaption className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[13px] font-[650] text-title">{title}</span>
        <span className="text-xs text-muted">
          {h ? (
            <>
              {ddmm(h.date)}: <b className="text-ink">{format(h.value)}</b>
            </>
          ) : (
            summary
          )}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart w-full" role="img" aria-label={`${title}. Total ${format(total)}.`} onMouseLeave={() => setHover(null)}>
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} className="chart-axis" />
        {children({ hover, slot, innerH, setHover })}
        {ticks.map((i) => (
          <text
            key={i}
            x={PAD.left + i * slot + slot / 2}
            y={H - 6}
            textAnchor={spaced && i === 0 ? "start" : spaced && i === points.length - 1 ? "end" : "middle"}
            className="chart-tick"
            data-active={hover === i ? "" : undefined}
          >
            {points[i] ? ddmm(points[i].date) : ""}
          </text>
        ))}
      </svg>
      <details className="no-print text-xs text-muted">
        <summary className="cursor-pointer">Ver em tabela</summary>
        <div className="scroll-x mt-1.5 max-h-48 overflow-y-auto">
          <table>
            <tbody>
              {points.map((p) => (
                <tr key={p.date}>
                  <td>{ddmm(p.date)}</td>
                  <td className="text-right tabular-nums">{format(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/**
 * Barras diárias de uma única medida (sem segundo eixo: investimento, leads e cliques são gráficos separados,
 * alinhados pela data). Passe o mouse para ver o valor do dia; a tabela fica em "Ver em tabela".
 * `label`: texto curto do valor acima de cada coluna (só em períodos curtos).
 */
export function DailyBars({
  title,
  points,
  format,
  label,
  tone = "accent",
}: {
  title: string;
  points: BarPoint[];
  format: (v: number) => string;
  label?: (v: number) => string;
  tone?: "accent" | "navy";
}) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const total = points.reduce((s, p) => s + p.value, 0);
  const showLabels = !!label && points.length <= VALUE_LABELS_MAX;

  return (
    <DailyFrame
      title={title}
      points={points}
      format={format}
      summary={
        <>
          Total: <b className="text-ink">{format(total)}</b> · maior dia: {format(max === 1 && total === 0 ? 0 : max)}
        </>
      }
    >
      {({ hover, slot, innerH, setHover }) => {
        const barW = Math.max(2, Math.min(28, slot - 2)); // 2px de respiro entre barras
        return points.map((p, i) => {
          const bh = p.value > 0 ? Math.max(2, (p.value / max) * innerH) : 0;
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const y = H - PAD.bottom - bh;
          const r = Math.min(4, barW / 2, bh);
          return (
            <g key={p.date} onMouseEnter={() => setHover(i)}>
              {/* Área de toque maior que a barra */}
              <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={innerH} fill="transparent" />
              {bh > 0 && (
                <path
                  className={`chart-bar ${tone}`}
                  data-dim={hover !== null && hover !== i ? "" : undefined}
                  d={`M${x},${H - PAD.bottom} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${H - PAD.bottom} Z`}
                />
              )}
              {showLabels && p.value > 0 && (
                <text x={x + barW / 2} y={y - 5} textAnchor="middle" className="chart-value">
                  {label!(p.value)}
                </text>
              )}
            </g>
          );
        });
      }}
    </DailyFrame>
  );
}

/** Reta de mínimos quadrados: quanto a medida sobe ou desce por dia. */
function linearTrend(values: number[]) {
  const n = values.length;
  if (n < 2) return null;
  const mx = (n - 1) / 2;
  const my = values.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  values.forEach((v, i) => {
    num += (i - mx) * (v - my);
    den += (i - mx) ** 2;
  });
  const slope = den ? num / den : 0;
  return { slope, at: (i: number) => my + slope * (i - mx) };
}

/**
 * Linha diária de uma medida com a linha de tendência (tracejada). Mesmo eixo de datas das barras.
 */
export function DailyLine({
  title,
  points,
  format,
  unit,
}: {
  title: string;
  points: BarPoint[];
  format: (v: number) => string;
  /** Nome da medida no plural, para o resumo da tendência ("cliques"). */
  unit: string;
}) {
  const values = points.map((p) => p.value);
  const trend = linearTrend(values);
  const max = Math.max(1, ...values, ...(trend ? [trend.at(0), trend.at(values.length - 1)] : []));
  const total = values.reduce((s, v) => s + v, 0);
  const showLabels = points.length <= VALUE_LABELS_MAX;
  // Variação diária pequena perto da média = estável.
  const avg = total / Math.max(1, values.length);
  const direction = !trend || Math.abs(trend.slope) < Math.max(0.5, avg * 0.02) ? "estável" : trend.slope > 0 ? "subindo" : "caindo";

  return (
    <DailyFrame
      title={title}
      points={points}
      format={format}
      summary={
        <>
          Total: <b className="text-ink">{format(total)}</b>
          {trend && (
            <>
              {" "}
              · tendência: <b className="text-ink">{direction}</b>
              {direction !== "estável" && ` (${trend.slope > 0 ? "+" : "−"}${format(Math.abs(Math.round(trend.slope)))} ${unit} por dia)`}
            </>
          )}
        </>
      }
    >
      {({ hover, slot, innerH, setHover }) => {
        const cx = (i: number) => PAD.left + i * slot + slot / 2;
        const cy = (v: number) => H - PAD.bottom - (Math.max(0, v) / max) * innerH;
        const path = points.map((p, i) => `${i ? "L" : "M"}${cx(i)},${cy(p.value)}`).join(" ");
        return (
          <>
            {trend && <line x1={cx(0)} y1={cy(trend.at(0))} x2={cx(points.length - 1)} y2={cy(trend.at(points.length - 1))} className="chart-trend" />}
            {points.length > 1 && <path d={path} className="chart-line" />}
            {hover !== null && <line x1={cx(hover)} x2={cx(hover)} y1={PAD.top} y2={H - PAD.bottom} className="chart-crosshair" />}
            {points.map((p, i) => (
              <g key={p.date} onMouseEnter={() => setHover(i)}>
                <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={innerH} fill="transparent" />
                <circle cx={cx(i)} cy={cy(p.value)} r={hover === i ? 5 : 4} className="chart-dot" />
                {showLabels && (
                  <text x={cx(i)} y={cy(p.value) - 9} textAnchor="middle" className="chart-value">
                    {format(p.value)}
                  </text>
                )}
              </g>
            ))}
          </>
        );
      }}
    </DailyFrame>
  );
}
