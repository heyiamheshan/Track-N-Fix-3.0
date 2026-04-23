/**
 * change-password/page.tsx — Mandatory First-Login Password Change
 *
 * Employees are created by the admin with a temporary password (isFirstLogin=true).
 * AuthContext detects this flag and redirects the user here before they can
 * access any other page.
 *
 * On success:
 *  - The API clears the isFirstLogin flag server-side.
 *  - The stored user object in localStorage is updated locally so the context
 *    does not redirect back here on the next render cycle.
 *  - After a 2-second success screen, login() is called to re-evaluate the role
 *    and route the user to their correct dashboard.
 */
"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/context/AuthContext";
import { authAPI } from "@/lib/api";
import { Shield, Eye, EyeOff, CheckCircle } from "lucide-react";

//Schema validation
const schema = z.object({
    currentPassword: z.string().min(1, "Current password required"),
    newPassword: z.string().min(6, "Minimum 6 characters"),
    confirmPassword: z.string().min(6),
}).refine(d => d.newPassword === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
});
type FormData = z.infer<typeof schema>;

//Change password page
export default function ChangePasswordPage() {
    const { user, login, logout } = useAuth();
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState(false);
    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);
//handle the form submission
    const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
        resolver: zodResolver(schema),
    });
//submit handler
    const onSubmit = async (data: FormData) => {
        setError("");
        setLoading(true);
        try {
            await authAPI.changePassword({ currentPassword: data.currentPassword, newPassword: data.newPassword });
            // Update stored user with isFirstLogin = false
            if (user) {
                const updatedUser = { ...user, isFirstLogin: false };
                localStorage.setItem("tnf_user", JSON.stringify(updatedUser));
            }
            setDone(true);
            setTimeout(() => {
                // Re-trigger login flow with updated flag
                const u = JSON.parse(localStorage.getItem("tnf_user") || "{}");
                const t = localStorage.getItem("tnf_token") || "";
                login(u, t);
            }, 2000);
        } catch (err: unknown) {
            const e = err as { response?: { data?: { error?: string } } };
            setError(e.response?.data?.error || "Failed to change password.");
        } finally {
            setLoading(false);
        }
    };
//if the password is changed successfully redirect to the dashboard
    if (done) {
        return (
            <div className="min-h-screen flex items-center justify-center p-4">
                <div className="w-full max-w-md text-center card animate-fade-in">
                    <div className="w-20 h-20 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-6">
                        <CheckCircle className="w-10 h-10 text-emerald-400" />
                    </div>
                    <h2 className="text-2xl font-bold text-white mb-2">Password Updated!</h2>
                    <p className="text-slate-400 text-sm">Redirecting you to your dashboard…</p>
                </div>
            </div>
        );
    }
//change password form
    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-40 -left-40 w-96 h-96 bg-violet-600/20 rounded-full blur-3xl" />
                <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl" />
            </div>

            <div className="w-full max-w-md animate-fade-in">
                <div className="text-center mb-8">
                    <img src="/logo.jpg" alt="TrackNFix Logo" className="mx-auto block w-20 h-20 object-cover rounded-3xl mb-4 shadow-xl shadow-blue-500/10" />
                    <h1 className="text-3xl font-bold text-white">Security Update</h1>
                    <p className="text-slate-400 mt-1 text-sm">Welcome, <span className="text-white font-medium">{user?.name}</span>! Please set a private password to continue.</p>
                </div>

                <div className="card border-violet-500/20">
                    <div className="flex items-center gap-2 mb-6">
                        <Shield className="w-4 h-4 text-violet-400" />
                        <h2 className="text-lg font-semibold">Change Password</h2>
                    </div>

                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 text-amber-300 text-xs mb-5">
                        This is a mandatory step required on your first login. Your temporary password must be replaced with a private one.
                    </div>

                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                        <div>
                            <label className="block text-sm text-slate-400 mb-1.5">Temporary / Current Password</label>
                            <div className="relative">
                                <input {...register("currentPassword")} type={showCurrent ? "text" : "password"} placeholder="••••••••" className="input-field pr-10" disabled={loading} />
                                <button type="button" onClick={() => setShowCurrent(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                                    {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                            {errors.currentPassword && <p className="text-red-400 text-xs mt-1">{errors.currentPassword.message}</p>}
                        </div>

                        <div>
                            <label className="block text-sm text-slate-400 mb-1.5">New Password</label>
                            <div className="relative">
                                <input {...register("newPassword")} type={showNew ? "text" : "password"} placeholder="Minimum 6 characters" className="input-field pr-10" disabled={loading} />
                                <button type="button" onClick={() => setShowNew(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                            {errors.newPassword && <p className="text-red-400 text-xs mt-1">{errors.newPassword.message}</p>}
                        </div>

                        <div>
                            <label className="block text-sm text-slate-400 mb-1.5">Confirm New Password</label>
                            <input {...register("confirmPassword")} type="password" placeholder="Repeat new password" className="input-field" disabled={loading} />
                            {errors.confirmPassword && <p className="text-red-400 text-xs mt-1">{errors.confirmPassword.message}</p>}
                        </div>

                        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">{error}</div>}

                        <button type="submit" className="btn-primary w-full" disabled={loading}>
                            {loading ? "Updating…" : "Set New Password & Continue →"}
                        </button>

                        <button type="button" onClick={logout} className="w-full text-center text-slate-600 hover:text-slate-400 text-xs mt-2 transition-colors">
                            Sign out instead
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
