"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { authAPI } from "@/lib/api";
import { Wrench, Lock, Zap } from "lucide-react";

const schema = z.object({
    email: z.email("Invalid email"),
    password: z.string().min(1, "Password required"),
});
type FormData = z.infer<typeof schema>;

const DEMO_ACCOUNTS = [
    { label: "Admin",    email: "admin@demo.com",    color: "from-blue-500/20 to-blue-600/10 border-blue-500/30 text-blue-300 hover:border-blue-400/50" },
    { label: "Manager",  email: "manager@demo.com",  color: "from-violet-500/20 to-violet-600/10 border-violet-500/30 text-violet-300 hover:border-violet-400/50" },
    { label: "Employee", email: "employee@demo.com", color: "from-emerald-500/20 to-emerald-600/10 border-emerald-500/30 text-emerald-300 hover:border-emerald-400/50" },
] as const;

const DEMO_PASSWORD = "demo1234";

export default function LoginPage() {
    const { login } = useAuth();
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [demoLoading, setDemoLoading] = useState<string | null>(null);

    const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
        resolver: zodResolver(schema),
    });

    const onSubmit = async (data: FormData) => {
        setError("");
        setLoading(true);
        try {
            const res = await authAPI.signin(data);
            login(res.data.user, res.data.token);
        } catch (err: unknown) {
            const e = err as { response?: { data?: { error?: string } } };
            setError(e.response?.data?.error || "Login failed. Check credentials.");
        } finally {
            setLoading(false);
        }
    };

    const loginAsDemo = async (email: string, label: string) => {
        setError("");
        setDemoLoading(label);
        try {
            const res = await authAPI.signin({ email, password: DEMO_PASSWORD });
            login(res.data.user, res.data.token);
        } catch {
            setError("Demo account unavailable. Please run the seed script first.");
        } finally {
            setDemoLoading(null);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            {/* Background blobs */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl" />
                <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-violet-600/15 rounded-full blur-3xl" />
            </div>

            <div className="w-full max-w-md animate-fade-in">
                {/* Header */}
                <div className="text-center mb-8">
                    <img src="/logo.jpg" alt="TrackNFix Logo" className="mx-auto block w-24 h-24 object-cover rounded-3xl mb-4 shadow-xl shadow-blue-500/10" />
                    <h1 className="text-3xl font-bold text-white">TrackNFix</h1>
                    <p className="text-slate-400 mt-1 text-sm">Jayakody Auto Electrical Automobile Workshop</p>
                </div>

                {/* Demo Accounts Banner */}
                <div className="card mb-4">
                    <div className="flex items-center gap-2 mb-3">
                        <Zap className="w-4 h-4 text-yellow-400" />
                        <span className="text-sm font-semibold text-yellow-300">Try the Demo — One Click Login</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        {DEMO_ACCOUNTS.map(({ label, email, color }) => (
                            <button
                                key={label}
                                onClick={() => loginAsDemo(email, label)}
                                disabled={!!demoLoading || loading}
                                className={`bg-gradient-to-b ${color} border rounded-lg px-3 py-2.5 text-xs font-semibold transition-all disabled:opacity-50`}
                            >
                                {demoLoading === label ? "…" : `👤 ${label}`}
                            </button>
                        ))}
                    </div>
                    <p className="text-xs text-slate-500 mt-2.5 text-center">
                        All demo accounts use password{" "}
                        <span className="font-mono text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">demo1234</span>
                    </p>
                </div>

                {/* Sign-in Form */}
                <div className="card">
                    <div className="flex items-center gap-2 mb-6">
                        <Lock className="w-4 h-4 text-blue-400" />
                        <h2 className="text-lg font-semibold">Sign In</h2>
                    </div>

                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                        <div>
                            <label className="block text-sm text-slate-400 mb-1.5">Email Address</label>
                            <input {...register("email")} type="email" placeholder="you@example.com" className="input-field" disabled={loading} />
                            {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email.message}</p>}
                        </div>
                        <div>
                            <label className="block text-sm text-slate-400 mb-1.5">Password</label>
                            <input {...register("password")} type="password" placeholder="••••••••" className="input-field" disabled={loading} />
                            {errors.password && <p className="text-red-400 text-xs mt-1">{errors.password.message}</p>}
                        </div>

                        {error && (
                            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">{error}</div>
                        )}

                        <button type="submit" className="btn-primary w-full mt-2" disabled={loading}>
                            {loading ? "Signing in…" : "Sign In"}
                        </button>
                    </form>

                    <p className="text-center text-slate-500 text-sm mt-6">
                        <Link href="/forgot-password" className="text-blue-400 hover:text-blue-300">
                            Forgot password?
                        </Link>
                    </p>
                    <p className="text-center text-slate-500 text-sm mt-2">
                        New admin/manager?{" "}
                        <Link href="/signup" className="text-blue-400 hover:text-blue-300 font-medium">
                            Create account
                        </Link>
                    </p>
                </div>

                <p className="text-center text-xs text-slate-600 mt-6 flex items-center justify-center gap-1">
                    <Wrench className="w-3 h-3" /> © 2025 Jayakody Auto Electrical.
                </p>
            </div>
        </div>
    );
}
