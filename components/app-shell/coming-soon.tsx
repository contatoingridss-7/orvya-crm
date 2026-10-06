/** Tela reservada para uma fase seguinte do KICKOFF.md. */
export function ComingSoon({ phase, children }: { phase: string; children: React.ReactNode }) {
  return (
    <div className="empty grid justify-items-center gap-2">
      <span className="pill ind">{phase}</span>
      <p className="m-0 max-w-[460px]">{children}</p>
    </div>
  );
}
