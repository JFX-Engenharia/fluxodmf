import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DJ Fluxo Notas",
    short_name: "Fluxo Notas",
    description: "Envio offline de fotos de notas fiscais do cartão CAJU.",
    start_url: "/notas",
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
