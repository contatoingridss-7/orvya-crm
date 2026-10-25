"use client";

import { useState } from "react";

export type BarPoint = { date: string; value: number };

const W = 640;
const H = 150;
const PAD = { top: 12, right: 8, bottom: 22, left: 8 };
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * Barras diárias de uma única medida (sem segundo eixo: investimento e leads são gráficos separados,
 * alinhados pela data). Passe o mouse para ver o valor do dia; a tabela fica em "Ver em tabela".
 */
export function DailyBars({ title, points, format, tone = "accent" }: { title: string; points: BarPoint[]; format: (v: number) => string; tone?: "accent" | "navy" }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...points.map((p) => p.value));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / Math.max(1, points.length);
  const barW = Math.max(2, Math.min(28, slot - 2)); // 2px de respiro entre barras
  const total = points.reduce((s, p) => s + p.value, 0);
  const ticks = points.length <= 1 ? [0] : [0, Math.floor((points.length - 1) / 2), points.length - 1];
  const h = hover !== null ? points[hover] : null;

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
            <>
              Total: <b className="text-ink">{format(total)}</b> · maior dia: {format(max === 1 && total === 0 ? 0 : max)}
            </>
          )}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart w-full" role="img" aria-label={`${title}. Total ${format(total)}.`} onMouseLeave={() => setHover(null)}>
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} className="chart-axis" />
        {points.map((p, i) => {
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
            </g>
          );
        })}
        {ticks.map((i) => (
          <text key={i} x={PAD.left + i * slot + slot / 2} y={H - 6} textAnchor={i === 0 && points.length > 1 ? "start" : i === points.length - 1 && points.length > 1 ? "end" : "middle"} className="chart-tick">
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
