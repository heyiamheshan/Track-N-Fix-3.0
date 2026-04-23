/**
 * DashboardLayout.tsx — Shared Page Shell for All Role Dashboards
 *
 * Wraps dashboard pages with:
 *  - A sticky top navigation bar (logo, role badge, user name, sign-out button)
 *  - A page header area (title, optional subtitle, optional action buttons)
 *  - A centred main content area with max-width constraint
 *  - A footer with the workshop name
 *
 * Route protection: if the user is not authenticated (no valid session in AuthContext),
 * the layout redirects to /login. While the session is loading it renders a spinner
 * so the protected content is never briefly visible.
 */
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { LogOut, Bell } from "lucide-react";

/** Props accepted by DashboardLayout — title is required, others are optional. */
interface DashboardLayoutProps {
    children: React.ReactNode;
    title: string;
    subtitle?: string;
    /** Rendered in the top-right of the page header; typically a primary action button. */
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
                        <img src="/logo.jpg" alt="TrackNFix" className="w-8 h-8 md:w-9 md:h-9 object-cover rounded-lg shrink-0 shadow-lg shadow-blue-500/20" />
                        <div>
                            <span className="font-bold text-white text-sm">TrackNFix</span>
                            <span className="text-slate-600 text-xs ml-1">3.0</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className={`badge ${roleColors[user.role] || "badge-blue"} hidden sm:flex`}>
                            {user.role}
                        </div>

                        {/* Profile avatar — shows first letter of name, full name and email on hover */}
                        <div className="hidden sm:flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center flex-shrink-0">
                                <span className="text-blue-400 font-bold text-sm">{user.name?.[0]?.toUpperCase()}</span>
                            </div>
                            <div className="flex flex-col leading-tight">
                                <span className="text-white text-xs font-medium">{user.name}</span>
                                <span className="text-slate-500 text-[10px]">{user.email}</span>
                            </div>
                        </div>

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
