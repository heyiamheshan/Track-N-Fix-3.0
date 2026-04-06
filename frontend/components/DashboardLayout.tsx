"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { Car, LogOut, Bell } from "lucide-react";

interface DashboardLayoutProps {
    children: React.ReactNode;
    title: string;
    subtitle?: string;
    actions?: React.ReactNode;
}

export default function DashboardLayout({ children, title, subtitle, actions }: DashboardLayoutProps) {
    const { user, logout, isLoading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!isLoading && !user) router.push("/login");
    }, [user, isLoading, router]);

    if (isLoading || !user) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-pulse-soft text-slate-400">Loading…</div>
            </div>
        );
    }

    const roleColors: Record<string, string> = {
        EMPLOYEE: "badge-blue",
        ADMIN: "badge-yellow",
        MANAGER: "badge-purple",
    };

    return (
        <div className="min-h-screen flex flex-col">
            {/* Top nav */}
            <header className="glass border-b border-white/8 sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
                            <Car className="w-4.5 h-4.5 text-blue-400" />
                        </div>
                        <div>
                            <span className="font-bold text-white text-sm">TrackNFix</span>
                            <span className="text-slate-600 text-xs ml-1">3.0</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className={`badge ${roleColors[user.role] || "badge-blue"} hidden sm:flex`}>
                            {user.role}
                        </div>
                        <span className="text-slate-400 text-sm hidden sm:block">{user.name}</span>
                        <button onClick={logout} className="flex items-center gap-1.5 text-slate-500 hover:text-slate-200 transition-colors text-sm">
                            <LogOut className="w-4 h-4" />
                            <span className="hidden sm:block">Sign out</span>
                        </button>
                    </div>
                </div>
            </header>

            {/* Page header */}
            <div className="border-b border-white/5 bg-white/2">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-bold text-white">{title}</h1>
                        {subtitle && <p className="text-slate-500 text-sm mt-0.5">{subtitle}</p>}
                    </div>
                    {actions && <div className="flex items-center gap-2">{actions}</div>}
                </div>
            </div>

            {/* Content */}
            <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
                {children}
            </main>

            {/* Footer */}
            <footer className="border-t border-white/5 py-4 text-center text-xs text-slate-700">
                Jayakody Auto Electrical Automobile Workshop · TrackNFix 3.0
            </footer>
        </div>
    );
}
