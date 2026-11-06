import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Conversor de áudio (mensagem de voz): binário fora do bundle, incluído só na rota que converte.
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: { "/api/audio/voz": ["./node_modules/ffmpeg-static/ffmpeg"] },
  experimental: {
    // Importação do catálogo envia centenas de produtos de uma vez.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
