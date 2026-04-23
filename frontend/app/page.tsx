/**
 * Root entry page ("/").
 * Acts purely as a role-based redirect — it never renders a real UI.
 * Once the auth state resolves, the user is sent to the correct dashboard:
 *   - Not logged in  →  /login
 *   - EMPLOYEE role  →  /employee
 *   - ADMIN role     →  /admin
 *   - MANAGER role   →  /manager
 *
 * router.replace() is used instead of router.push() so the loading screen
 * is not added to the browser history (the back button won't return to it).
 */
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function Home() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  // Wait for AuthProvider to finish checking the stored session before redirecting.
  useEffect(() => {
    if (!isLoading) {
      if (!user) router.replace("/login");
      else if (user.role === "EMPLOYEE") router.replace("/employee");
      else if (user.role === "ADMIN") router.replace("/admin");
      else if (user.role === "MANAGER") router.replace("/manager");
    }
  }, [user, isLoading, router]);

  // Shown while isLoading is true (auth check in progress).
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-pulse-soft text-slate-400">Loading TrackNFix…</div>
    </div>
  );
}
