import axios, { AxiosHeaders, type InternalAxiosRequestConfig } from "axios";

import { fetchCurrentUser } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";

let refreshQueued = false;
let refreshRunning = false;

async function refreshCurrentUser() {
    const token = useUserStore.getState().token;
    if (!token) return;
    try {
        const user = await fetchCurrentUser(token);
        const session = useUserStore.getState();
        if (session.token !== token) return;
        if (user.role === "guest") session.clearSession();
        else if (!session.user || session.user.credits !== user.credits) session.setSession(token, session.user ? { ...session.user, credits: user.credits } : user);
    } catch {
        // A failed balance refresh must not break the original request.
    }
}

export function queueCreditBalanceRefresh() {
    refreshQueued = true;
    if (refreshRunning) return;
    refreshRunning = true;
    void (async () => {
        try {
            while (refreshQueued) {
                refreshQueued = false;
                await refreshCurrentUser();
            }
        } finally {
            refreshRunning = false;
        }
    })();
}

function shouldRefreshCredits(config?: InternalAxiosRequestConfig) {
    const token = useUserStore.getState().token;
    if (!token || !config?.url) return false;
    const path = new URL(config.url, "http://localhost").pathname;
    return path.startsWith("/api/") && path !== "/api/auth/me" && AxiosHeaders.from(config.headers).get("Authorization") === `Bearer ${token}`;
}

export function startCreditBalanceSync() {
    const refresh = (config?: InternalAxiosRequestConfig) => {
        if (shouldRefreshCredits(config)) queueCreditBalanceRefresh();
    };
    const interceptor = axios.interceptors.response.use(
        (response) => {
            refresh(response.config);
            return response;
        },
        (error) => {
            if (axios.isAxiosError(error)) refresh(error.config);
            return Promise.reject(error);
        },
    );
    return () => axios.interceptors.response.eject(interceptor);
}
