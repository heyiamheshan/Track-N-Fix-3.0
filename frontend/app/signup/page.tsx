/**
 * signup/page.tsx — Account Creation Page (Admin / Manager only)
 *
 * Allows new ADMIN or MANAGER users to self-register. The system enforces a
 * maximum of 2 accounts per privileged role — the availability check runs on
 * mount and disables the role option when the limit is reached.
 *
 * On successful registration the user is immediately logged in via AuthContext,
 * matching the same flow as the login page.
 */
"use client";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { authAPI } from "@/lib/api";
import { UserPlus } from "lucide-react";

/** Zod validation schema — enforces minimum lengths and valid email format before the API is called. */
const schema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    email: z.string().email("Invalid email"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    role: z.enum(["ADMIN", "MANAGER"]),
});

/** TypeScript type inferred directly from the Zod schema — stays in sync automatically. */
type FormData = z.infer<typeof schema>;

/** Shape of the /api/auth/role-availability response; used to disable a role card when its slot is full. */
interface RoleAvailability {
    ADMIN: { count: number; available: boolean };
    MANAGER: { count: number; available: boolean };
}

export default function SignupPage() {
    const { login } = useAuth();
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    /** Holds role slot data fetched on mount; null while the request is in flight. */
    const [availability, setAvailability] = useState<RoleAvailability | null>(null);

    const { register, handleSubmit, watch, formState: { errors } } = useForm<FormData>({
        resolver: zodResolver(schema),
        defaultValues: { role: "ADMIN" },
    });

    /** Tracks the currently selected role so the role card styling updates live. */
    const selectedRole = watch("role");

    // Fetch role slot availability on mount to know which role cards to disable.
    useEffect(() => {
        authAPI.roleAvailability().then(res => setAvailability(res.data)).catch(() => { });
    }, []);

    /** Submits signup credentials; on success logs in the new user immediately via AuthContext. */
    const onSubmit = async (data: FormData) => {
        setError("");
        setLoading(true);
        try {
            const res = await authAPI.signup(data);
            login(res.data.user, res.data.token);
        } catch (err: unknown) {
            const e = err as { response?: { data?: { error?: string } } };
            setError(e.response?.data?.error || "Signup failed.");
        } finally {
            setLoading(false);
        }
    };

    /** Returns true when the given role has reached its maximum account limit. */
    const roleUnavailable = (role: string) => {
        if (!availability) return false;
        if (role === "ADMIN") return !availability.ADMIN.available;
        if (role === "MANAGER") return !availability.MANAGER.available;
        return false;
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            {/* Decorative blurred background blobs — pointer-events-none so they don't block clicks */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-40 -left-40 w-96 h-96 bg-violet-600/20 rounded-full blur-3xl" />
                <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl" />
            </div>

            <div className="w-full max-w-md animate-fade-in">
                {/* Page header — logo, app name, subtitle */}
                <div className="text-center mb-8">
                    <img src="/logo.jpg" alt="TrackNFix Logo" className="mx-auto block w-24 h-24 object-cover rounded-3xl mb-4 shadow-xl shadow-blue-500/10" />
                    <h1 className="text-3xl font-bold text-white">TrackNFix</h1>
                    <p className="text-slate-400 mt-1 text-sm">Create your account</p>
                </div>

                <div className="card">
                    <div className="flex items-center gap-2 mb-6">
                        <UserPlus className="w-4 h-4 text-blue-400" />
                        <h2 className="text-lg font-semibold">Sign Up</h2>
                    </div>

                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                        {/* Full Name field */}
                        <div>
                            <label className="block text-sm text-slate-400 mb-1.5">Full Name</label>
                            <input {...register("name")} placeholder="John Doe" className="input-field" disabled={loading} />
                            {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name.message}</p>}
                        </div>

                        {/* Email field */}
                        <div>
                            <label className="block text-sm text-slate-400 mb-1.5">Email Address</label>
                            <input {...register("email")} type="email" placeholder="you@example.com" className="input-field" disabled={loading} />
                            {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email.message}</p>}
                        </div>

                        {/* Password field */}
                        <div>
                            <label className="block text-sm text-slate-400 mb-1.5">Password</label>
                            <input {...register("password")} type="password" placeholder="••••••••" className="input-field" disabled={loading} />
                            {errors.password && <p className="text-red-400 text-xs mt-1">{errors.password.message}</p>}
                        </div>

                        {/* Role selector — cards are disabled when the role slot is already full */}
                        <div>
                            <label className="block text-sm text-slate-400 mb-2">Role</label>
                            <div className="grid grid-cols-2 gap-2">
                                {(["ADMIN", "MANAGER"] as const).map(role => {
                                    const unavailable = roleUnavailable(role);
                                    return (
                                        <label
                                            key={role}
                                            className={`relative flex flex-col items-center gap-1.5 p-3 rounded-xl border cursor-pointer transition-all duration-200 text-center ${unavailable ? "opacity-40 cursor-not-allowed border-white/5 bg-white/3" : selectedRole === role ? "border-blue-500/50 bg-blue-600/15 text-blue-300" : "border-white/10 bg-white/5 hover:bg-white/8 text-slate-400"}`}
                                        >
                                            {/* sr-only hides the radio input visually; the label card acts as the click target */}
                                            <input type="radio" value={role} {...register("role")} className="sr-only" disabled={unavailable || loading} />
                                            <span className="text-xs font-medium">{role === "ADMIN" ? "Admin" : "Manager"}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        </div>

                        {/* API error message */}
                        {error && (
                            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">{error}</div>
                        )}

                        {/* Submit button — disabled while submitting or if the selected role is full */}
                        <button type="submit" className="btn-primary w-full" disabled={loading || roleUnavailable(selectedRole)}>
                            {loading ? "Creating account…" : "Create Account"}
                        </button>
                    </form>

                    {/* Link back to login for users who already have an account */}
                    <p className="text-center text-slate-500 text-sm mt-6">
                        Already have an account?{" "}
                        <Link href="/login" className="text-blue-400 hover:text-blue-300 font-medium">Sign in</Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
