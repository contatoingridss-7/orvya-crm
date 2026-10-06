import { Brand, Signature } from "@/components/brand";

// Login, recuperação e redefinição de senha: sempre escuras, com o brilho violeta do protótipo.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-theme="dark" className="auth-screen">
      <main className="mx-auto flex min-h-dvh w-full max-w-[400px] flex-col justify-center gap-7 px-4 py-10">
        <div className="flex justify-center">
          <Brand />
        </div>
        <div className="panel grid gap-4 !p-6">{children}</div>
        <div className="flex justify-center">
          <Signature />
        </div>
      </main>
    </div>
  );
}
