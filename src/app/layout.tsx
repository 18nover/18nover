import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Space_Grotesk } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "18nover",
    template: "%s · 18nover",
  },
  description: "Private, one-to-many RTSP camera streaming through an authenticated WebRTC relay.",
  applicationName: "18nover",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
  openGraph: {
    title: "18nover",
    description: "Private RTSP cameras, delivered securely through a self-hosted WebRTC relay.",
    type: "website",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "18nover private streaming operations dashboard" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "18nover",
    description: "Private RTSP cameras, delivered securely through a self-hosted WebRTC relay.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#f4f6fb",
  colorScheme: "light dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${spaceGrotesk.variable} ${plexSans.variable} ${plexMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
