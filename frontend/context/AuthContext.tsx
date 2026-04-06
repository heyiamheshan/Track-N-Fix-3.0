"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useRouter } from "next/navigation";

interface User {
    id: string;
    name: string;
    email: string;
    role: "EMPLOYEE" | "ADMIN" | "MANAGER";
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    login: (user: User, token: string) => void;
    logout: () => void;
    isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const router = useRouter();

    useEffect(() => {
        const savedToken = localStorage.getItem("tnf_token");
        const savedUser = localStorage.getItem("tnf_user");
        if (savedToken && savedUser) {
            setToken(savedToken);
            setUser(JSON.parse(savedUser));
        }
        setIsLoading(false);
    }, []);

    const login = (user: User, token: string) => {
        setUser(user);
        setToken(token);
        localStorage.setItem("tnf_token", token);
        localStorage.setItem("tnf_user", JSON.stringify(user));

        // Redirect based on role
        if (user.role === "EMPLOYEE") router.push("/employee");
        else if (user.role === "ADMIN") router.push("/admin");
        else if (user.role === "MANAGER") router.push("/manager");
    };

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

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
}
