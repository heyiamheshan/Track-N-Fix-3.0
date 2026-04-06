"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { authAPI } from "@/lib/api";
import { Car, Wrench, Lock } from "lucide-react";

const schema = z.object({
    email: z.string().email("Invalid email"),
    password: z.string().min(1, "Password required"),
});
type FormData = z.infer<typeof schema>;

export default function LoginPage() {
    const { login } = useAuth();
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

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
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600/20 border border-blue-500/30 mb-4">
                        <Car className="w-8 h-8 text-blue-400" />
                    </div>
                    <h1 className="text-3xl font-bold text-white">TrackNFix</h1>
                    <p className="text-slate-400 mt-1 text-sm">Jayakody Auto Electrical Automobile Workshop</p>
                </div>

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
                        New to TrackNFix?{" "}
                        <Link href="/signup" className="text-blue-400 hover:text-blue-300 font-medium">
                            Create account
                        </Link>
                    </p>
                </div>

                <p className="text-center text-xs text-slate-600 mt-6 flex items-center justify-center gap-1">
                    <Wrench className="w-3 h-3" /> Powered by TrackNFix 3.0
                </p>
            </div>
        </div>
    );
}
