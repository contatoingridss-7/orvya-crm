import type { Metadata, Viewport } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import { themeInitScript } from "@/components/theme-toggle";
import { SLOGAN } from "@/components/brand";
import "./globals.css";

// Fontes da marca VÉR7ICE: Manrope nos títulos, DM Sans no texto.
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap" });

export const metadata: Metadata = {
  title: { default: `Orvya · ${SLOGAN}`, template: "%s · Orvya" },
  description: "CRM comercial com WhatsApp, agente de IA e funil de vendas.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F2ED" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0D0F" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${manrope.variable} ${dmSans.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
