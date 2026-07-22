"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { AppTopNav } from "@/components/layout/app-top-nav";
import { canRenderProtectedData } from "@/lib/account-storage";
import { useUserStore } from "@/stores/use-user-store";

// Public paths that don't require login. Everything else redirects to /login.
const PUBLIC_PATHS = new Set(["/", "/login"]);

// Strip control chars, require leading "/", reject protocol-relative "//" and "/\"
// (mirrors login/index.tsx safeRedirect — kept inline; one place, small enough).
function safeRedirect(value: string): string {
    const cleaned = (value ?? "").replace(/[\t\n\r]/g, "");
    if (!cleaned.startsWith("/") || cleaned.startsWith("//") || cleaned.startsWith("/\\")) return "/";
    return cleaned;
}

export default function UserLayout({ children }: { children: ReactNode }) {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);

    useEffect(() => {
        if (!isReady) return;
        const isPublic = PUBLIC_PATHS.has(pathname) || pathname === "/admin/login";
        if (!user && !isPublic) {
            navigate(`/login?redirect=${encodeURIComponent(safeRedirect(pathname))}`, { replace: true });
        }
    }, [isReady, user, pathname, navigate]);

    const isPublic = PUBLIC_PATHS.has(pathname) || pathname === "/admin/login";
    if (!isPublic && !canRenderProtectedData(isReady, Boolean(token && user))) {
        return <div className="flex h-dvh items-center justify-center bg-background" />;
    }

    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
            <AppTopNav />
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
    );
}
