/**
 * Aparece na hora em que a pessoa troca de tela (Painel → Funil → Conversas),
 * enquanto o servidor busca os dados. A lateral continua no lugar.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Carregando">
      <header className="top">
        <div className="grid gap-2">
          <span className="skeleton h-6 w-44" />
          <span className="skeleton h-3.5 w-72 max-w-[60vw]" />
        </div>
      </header>
      <div className="content grid gap-4">
        <div className="kpis">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="kpi grid gap-2">
              <span className="skeleton h-3 w-24" />
              <span className="skeleton h-6 w-16" />
            </div>
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="panel grid gap-3">
              <span className="skeleton h-4 w-40" />
              {Array.from({ length: 4 }, (_, j) => (
                <span key={j} className="skeleton h-10 w-full" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
