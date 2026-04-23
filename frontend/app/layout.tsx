/**
 * Root layout — applied to every page in the app.
 * Wraps the entire tree with AuthProvider so that any page can access
 * the current user session via the useAuth() hook.
 * Inter (Google Font) is loaded here once and applied globally through inter.className.
 */
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";

// Subset to "latin" to keep the font bundle small — covers all characters used in the app.
const inter = Inter({ subsets: ["latin"] });

/** Browser tab title and meta description for the entire application. */
export const metadata: Metadata = {
  title: "TrackNFix — Jayakody Auto Electrical",
  description: "Vehicle Service Record Management System for Jayakody Auto Electrical Automobile Workshop",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {/* AuthProvider makes user session available app-wide without prop drilling */}
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
