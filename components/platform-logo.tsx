import { cn } from "@/lib/cn";

/** Logotipo da plataforma de anúncios, para identificar a origem sem depender só do nome. */
export function PlatformLogo({ platform, className, size = 18 }: { platform: "meta" | "google"; className?: string; size?: number }) {
  if (platform === "google") {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} className={cn("flex-none", className)} role="img" aria-label="Google Ads">
        <path d="M9.4 3.5 2.6 15.3a3.4 3.4 0 1 0 5.9 3.4l6.8-11.8L9.4 3.5Z" fill="#FBBC04" />
        <path d="M21.5 15.3 14.7 3.5a3.4 3.4 0 0 0-5.9 3.4l6.8 11.8a3.4 3.4 0 1 0 5.9-3.4Z" fill="#4285F4" />
        <circle cx="5.6" cy="17" r="3.4" fill="#34A853" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={cn("flex-none", className)} role="img" aria-label="Meta Ads">
      <defs>
        <linearGradient id="meta-logo-g" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0064E1" />
          <stop offset="0.6" stopColor="#0082FB" />
          <stop offset="1" stopColor="#0099FF" />
        </linearGradient>
      </defs>
      <path
        d="M6.3 6.5c-2.4 0-4.3 3.3-4.3 6.6 0 2.4 1.1 4.4 3.2 4.4 1.6 0 2.8-1 4.6-4l.9-1.6.9 1.6c1.8 3 3 4 4.6 4 2.1 0 3.8-2 3.8-5.2 0-3.4-1.9-5.8-4.4-5.8-1.6 0-3 1-4.4 3.1-1.4-2.1-2.7-3.1-4.9-3.1Zm.4 2.6c1.1 0 2 .8 3.3 2.9l-1.1 1.8c-1.3 2.1-2 2.8-2.9 2.8-.9 0-1.6-.9-1.6-2.8 0-2.5 1.1-4.7 2.3-4.7Zm9.2 0c1.4 0 2.6 1.9 2.6 4.4 0 1.9-.8 2.9-1.7 2.9-.9 0-1.5-.6-2.9-2.9l-1.1-1.8c1.2-1.8 2.1-2.6 3.1-2.6Z"
        fill="url(#meta-logo-g)"
      />
    </svg>
  );
}

export const PLATFORM_NAME = { meta: "Meta Ads", google: "Google Ads" } as const;
