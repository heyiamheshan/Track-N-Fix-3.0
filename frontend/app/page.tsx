"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function Home() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading) {
      if (!user) router.replace("/login");
      else if (user.role === "EMPLOYEE") router.replace("/employee");
      else if (user.role === "ADMIN") router.replace("/admin");
      else if (user.role === "MANAGER") router.replace("/manager");
    }
  }, [user, isLoading, router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-pulse-soft text-slate-400">Loading TrackNFix…</div>
    </div>
  );
}
