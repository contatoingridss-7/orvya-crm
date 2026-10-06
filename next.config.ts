import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Importação do catálogo envia centenas de produtos de uma vez.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
