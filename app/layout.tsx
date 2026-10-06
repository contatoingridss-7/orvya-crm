import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import { themeInitScript } from "@/components/theme-toggle";
import { SLOGAN } from "@/components/brand";
import "./globals.css";

// Reserva para quem não tem a fonte do sistema da Apple.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: `Orvya · ${SLOGAN}`, template: "%s · Orvya" },
  description: "CRM comercial com WhatsApp, agente de IA e funil de vendas.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F4F7" },
    { media: "(prefers-color-scheme: dark)", color: "#07070A" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
