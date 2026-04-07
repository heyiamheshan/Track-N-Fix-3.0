"use client";
import { useState } from "react";
import Link from "next/link";
import { authAPI } from "@/lib/api";
import { Mail, KeyRound, Lock, CheckCircle, ArrowLeft } from "lucide-react";

type ForgotStep = "email" | "otp" | "reset" | "done";

export default function ForgotPasswordPage() {
    const [step, setStep] = useState<ForgotStep>("email");
    const [email, setEmail] = useState("");
    const [otp, setOtp] = useState("");
    const [resetToken, setResetToken] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    const handleSendOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            await authAPI.forgotPassword({ email });
            setMessage("If that email exists, an OTP has been sent to your inbox.");
            setStep("otp");
        } catch {
            setError("Failed to send OTP. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            const res = await authAPI.verifyOtp({ email, otp });
            setResetToken((res.data as { resetToken: string }).resetToken);
            setStep("reset");
        } catch {
            setError("Invalid or expired OTP. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleReset = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) { setError("Passwords do not match"); return; }
        if (newPassword.length < 6) { setError("Password must be at least 6 characters"); return; }
        setError("");
        setLoading(true);
        try {
            await authAPI.resetPassword({ resetToken, newPassword });
            setStep("done");
        } catch {
            setError("Reset failed. Your OTP may have expired.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-40 -right-40 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl" />
                <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-violet-600/15 rounded-full blur-3xl" />
            </div>

            <div className="w-full max-w-md animate-fade-in">
                <div className="text-center mb-8">
                    <img src="/logo.jpg" alt="TrackNFix" className="mx-auto block w-20 h-20 object-cover rounded-3xl mb-4 shadow-xl" />
                    <h1 className="text-3xl font-bold text-white">Forgot Password</h1>
                    <p className="text-slate-400 mt-1 text-sm">We'll send a one-time code to your email.</p>
                </div>

                {/* Progress */}
                {step !== "done" && (
                    <div className="flex items-center gap-2 mb-6">
                        {(["email", "otp", "reset"] as const).map((s, i) => (
                            <div key={s} className="flex items-center gap-2 flex-1">
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${s === step ? "bg-blue-600 text-white" : (["otp", "reset"].indexOf(step) > i) ? "bg-emerald-500 text-white" : "bg-white/10 text-slate-500"}`}>
                                    {["otp", "reset"].indexOf(step) > i ? "✓" : i + 1}
                                </div>
                                <span className={`text-xs hidden sm:block ${s === step ? "text-blue-300" : "text-slate-600"}`}>{s === "email" ? "Email" : s === "otp" ? "Verify OTP" : "Reset"}</span>
                                {i < 2 && <div className={`h-px flex-1 ${["otp", "reset"].indexOf(step) > i ? "bg-emerald-500/50" : "bg-white/10"}`} />}
                            </div>
                        ))}
                    </div>
                )}

                <div className="card">
                    {/* Step 1: Email */}
                    {step === "email" && (
                        <form onSubmit={handleSendOtp} className="space-y-4">
                            <div className="flex items-center gap-2 mb-4">
                                <Mail className="w-4 h-4 text-blue-400" />
                                <h2 className="text-lg font-semibold">Enter your email</h2>
                            </div>
                            <div>
                                <label className="block text-sm text-slate-400 mb-1.5">Registered Email Address</label>
                                <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="you@example.com" className="input-field" disabled={loading} required />
                            </div>
                            {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">{error}</div>}
                            <button type="submit" className="btn-primary w-full" disabled={loading || !email}>
                                {loading ? "Sending OTP…" : "Send OTP →"}
                            </button>
                        </form>
                    )}

                    {/* Step 2: OTP */}
                    {step === "otp" && (
                        <form onSubmit={handleVerifyOtp} className="space-y-4">
                            <div className="flex items-center gap-2 mb-2">
                                <KeyRound className="w-4 h-4 text-blue-400" />
                                <h2 className="text-lg font-semibold">Enter OTP</h2>
                            </div>
                            {message && <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-3 text-emerald-300 text-sm">{message}</div>}
                            <div>
                                <label className="block text-sm text-slate-400 mb-1.5">6-Digit Code</label>
                                <input
                                    value={otp}
                                    onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={6}
                                    placeholder="000000"
                                    className="input-field text-center text-2xl font-mono tracking-[0.6em]"
                                    disabled={loading}
                                    required
                                />
                                <p className="text-slate-600 text-xs mt-1 text-center">Check your inbox. Code expires in 10 minutes.</p>
                            </div>
                            {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">{error}</div>}
                            <button type="submit" className="btn-primary w-full" disabled={loading || otp.length !== 6}>
                                {loading ? "Verifying…" : "Verify Code →"}
                            </button>
                            <button type="button" onClick={() => { setStep("email"); setError(""); setOtp(""); }} className="w-full text-center text-slate-600 text-xs hover:text-slate-400 mt-1">
                                ← Resend / Use different email
                            </button>
                        </form>
                    )}

                    {/* Step 3: New password */}
                    {step === "reset" && (
                        <form onSubmit={handleReset} className="space-y-4">
                            <div className="flex items-center gap-2 mb-4">
                                <Lock className="w-4 h-4 text-blue-400" />
                                <h2 className="text-lg font-semibold">Set New Password</h2>
                            </div>
                            <div>
                                <label className="block text-sm text-slate-400 mb-1.5">New Password</label>
                                <input value={newPassword} onChange={e => setNewPassword(e.target.value)} type="password" placeholder="Minimum 6 characters" className="input-field" disabled={loading} required />
                            </div>
                            <div>
                                <label className="block text-sm text-slate-400 mb-1.5">Confirm Password</label>
                                <input value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} type="password" placeholder="Repeat new password" className="input-field" disabled={loading} required />
                            </div>
                            {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">{error}</div>}
                            <button type="submit" className="btn-primary w-full" disabled={loading}>
                                {loading ? "Resetting…" : "Reset Password →"}
                            </button>
                        </form>
                    )}

                    {/* Done */}
                    {step === "done" && (
                        <div className="text-center py-6">
                            <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
                                <CheckCircle className="w-8 h-8 text-emerald-400" />
                            </div>
                            <h2 className="text-xl font-bold text-white mb-2">Password Reset!</h2>
                            <p className="text-slate-400 text-sm mb-6">Your password has been updated. Please sign in with your new credentials.</p>
                            <Link href="/login" className="btn-primary inline-block">← Back to Sign In</Link>
                        </div>
                    )}
                </div>

                {step !== "done" && (
                    <p className="text-center text-sm text-slate-600 mt-6">
                        <Link href="/login" className="text-blue-400 hover:text-blue-300 flex items-center justify-center gap-1">
                            <ArrowLeft className="w-3 h-3" /> Back to Sign In
                        </Link>
                    </p>
                )}
            </div>
        </div>
    );
}
