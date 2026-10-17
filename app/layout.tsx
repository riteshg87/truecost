import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ServiceWorker } from "@/components/ServiceWorker";
import { CompareProvider } from "@/lib/store";
import { LoanProvider } from "@/lib/loanStore";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { AuthProvider } from "@/lib/auth/provider";
import { RouteGuard } from "@/components/RouteGuard";
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
    // Unmediated first, so an explicit choice has one meta to rewrite.
    { color: "#f7f7f4" },
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
      <head>
        {/* Runs before first paint. An effect would run after the browser has
            already painted, which is the flash this exists to avoid. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <AuthProvider>
          <CompareProvider>
            <LoanProvider>
              <RouteGuard>{children}</RouteGuard>
            </LoanProvider>
          </CompareProvider>
        </AuthProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
