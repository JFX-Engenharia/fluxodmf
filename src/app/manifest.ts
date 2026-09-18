import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/notas",
    name: "DJ Fluxo",
    short_name: "DJ Fluxo",
    description: "Solicitações, aprovações de compras e envio de notas fiscais.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F5F5F5",
    theme_color: "#258F3D",
    lang: "pt-BR",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
