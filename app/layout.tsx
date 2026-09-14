import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ServiceWorker } from "@/components/ServiceWorker";
import { CompareProvider } from "@/lib/store";
import { LoanProvider } from "@/lib/loanStore";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TrueCost — what a loan actually costs",
  description:
    "Compare loan offers on effective APR and cost per lakh, with every fee, GST rupee and financed premium counted. Runs entirely on your device.",
  manifest: "/manifest.webmanifest",
  applicationName: "TrueCost",
  appleWebApp: { capable: true, title: "TrueCost", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0f12" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <CompareProvider>
          <LoanProvider>{children}</LoanProvider>
        </CompareProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
