import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "DJ Fluxo | Fluxo de pagamentos",
  description: "Painel interno para importar, aprovar e auditar o fluxo de pagamentos.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
  appleWebApp: {
    capable: true,
    title: "Notas",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#258F3D",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
