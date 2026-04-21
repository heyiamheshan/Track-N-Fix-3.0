"use client";

/**
 * AuthContext.tsx — Global Authentication State
 *
 * Provides application-wide authentication state and actions via React Context.
 * Wraps the app with `AuthProvider` so any component can access the current
 * user, token, and auth functions through the `useAuth` hook.
 *
 * Features:
 *  - Persists session to localStorage (keys: "tnf_token", "tnf_user") so the
 *    user stays logged in across page refreshes.
 *  - Restores session on initial mount (useEffect reads localStorage).
 *  - `login()` redirects to the correct dashboard based on the user's role.
 *  - First-login employees are redirected to /change-password before anything else.
 *  - `logout()` clears state and storage, then redirects to /login.
 *
 * Usage:
 *   const { user, token, login, logout, isLoading } = useAuth();
 */

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useRouter } from "next/navigation";

// ── Type Definitions ──────────────────────────────────────────────────────────

/** Represents the authenticated user's identity and role. */
interface User {
    id: string;
    name: string;
    email: string;
    role: "EMPLOYEE" | "ADMIN" | "MANAGER";
    isFirstLogin?: boolean; // True on first login — forces password change
}

/** Shape of the AuthContext value exposed to consumers. */
interface AuthContextType {
    user: User | null;         // null when not authenticated
    token: string | null;      // JWT for API requests; null when not authenticated
    login: (user: User, token: string) => void;
    logout: () => void;
    isLoading: boolean;        // True while restoring session from localStorage on mount
}

// ── Context Creation ──────────────────────────────────────────────────────────

/** Initialised as null; consumers must be wrapped in AuthProvider. */
const AuthContext = createContext<AuthContextType | null>(null);

// ── AuthProvider Component ────────────────────────────────────────────────────

/**
 * AuthProvider
 *
 * Wraps the application (or a subtree) with authentication state.
 * Place this high in the component tree (typically in layout.tsx) so all
 * pages have access to auth state.
 *
 * @param children – React child nodes to render inside the provider
 */
export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser]       = useState<User | null>(null);
    const [token, setToken]     = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true); // Prevents flash of unauthenticated UI
    const router = useRouter();

    // ── Session Restoration ───────────────────────────────────────────────────
    /**
     * On mount, attempt to restore a previously saved session from localStorage.
     * isLoading stays true until this check completes so layout guards don't
     * redirect the user before the session is known.
     */
    useEffect(() => {
        const savedToken = localStorage.getItem("tnf_token");
        const savedUser  = localStorage.getItem("tnf_user");
        if (savedToken && savedUser) {
            setToken(savedToken);
            setUser(JSON.parse(savedUser));
        }
        setIsLoading(false); // Session check complete — safe to render auth-gated UI
    }, []);

    // ── Login ─────────────────────────────────────────────────────────────────
    /**
     * Stores the authenticated user and token, persists them to localStorage,
     * and redirects to the appropriate dashboard based on role.
     *
     * First-login employees are sent to /change-password before their dashboard
     * because they must set a personal password before accessing the system.
     */
    const login = (user: User, token: string) => {
        setUser(user);
        setToken(token);
        localStorage.setItem("tnf_token", token);
        localStorage.setItem("tnf_user", JSON.stringify(user));

        // First-login employees must change their password before anything else
        if (user.isFirstLogin) {
            router.push("/change-password");
            return;
        }

        // Route each role to their own dedicated dashboard
        if (user.role === "EMPLOYEE")      router.push("/employee");
        else if (user.role === "ADMIN")    router.push("/admin");
        else if (user.role === "MANAGER")  router.push("/manager");
    };

    // ── Logout ────────────────────────────────────────────────────────────────
    /**
     * Clears all authentication state and storage, then redirects to the login page.
     * Called when the user explicitly signs out or when a 401 error is received.
     */
    const logout = () => {
        setUser(null);
        setToken(null);
        localStorage.removeItem("tnf_token");
        localStorage.removeItem("tnf_user");
        router.push("/login");
    };

    return (
        <AuthContext.Provider value={{ user, token, login, logout, isLoading }}>
            {children}
        </AuthContext.Provider>
    );
}

// ── useAuth Hook ──────────────────────────────────────────────────────────────

/**
 * useAuth
 *
 * Custom hook for consuming the AuthContext.
 * Throws a descriptive error if used outside of AuthProvider to catch
 * misconfigured component trees early during development.
 *
 * @returns AuthContextType — { user, token, login, logout, isLoading }
 */
export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
}
