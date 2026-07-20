"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { App } from "antd";

import { createModelChannel, useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { syncScheduler } from "@/services/sync-scheduler";
import { syncClient } from "@/services/sync-client";
import { fetchCurrentUser } from "@/services/api/auth";
import { revalidateSession, startSessionMonitor } from "@/services/session-monitor";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const handledConfigParams = useRef(false);
    const { pathname } = useLocation();
    const hydrateUser = useUserStore((state) => state.hydrateUser);
    const userId = useUserStore((state) => state.user?.id);
    const loadPublicSettings = useConfigStore((state) => state.loadPublicSettings);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const isLoginPage = pathname === "/login" || pathname === "/admin/login";

    useEffect(() => {
        void loadPublicSettings();
    }, [loadPublicSettings]);

    // Zustand persist rehydration is async. On cold page load (e.g. after
    // login → window.location.reload), the useEffect may fire before
    // rehydration finishes, so get().token is still "" and hydrateUser
    // incorrectly clears the session.  wait for rehydration first.
    useEffect(() => {
        if (isLoginPage) return;
        void Promise.resolve(useUserStore.persist.rehydrate()).then(() => {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            useUserStore.getState().hydrateUser();
        });
    }, [isLoginPage]);

    // 新浏览器/设备：token 持久化但 user.id 来自异步 hydrateUser。
    // syncScheduler.start 和 onRehydrateStorage 在挂载时触发同步——早于 user.id 生成——导致同步无操作。
    // 等 user id 生成后重新触发同步，确保从后端拉取素材。
    useEffect(() => {
        if (userId) {
            syncClient.syncAll().catch(() => {});
            // ponytail: also trigger a direct asset refresh so "my assets" gets full
            // dataset on first auth, not just sync deltas
            useAssetStore
                .getState()
                .refreshFromServer()
                .catch(() => {});
        }
    }, [userId]);

    useEffect(() => {
        syncScheduler.start();
        const stopSessionMonitor = startSessionMonitor(() => {
            const { token, clearSession } = useUserStore.getState();
            return revalidateSession(token, fetchCurrentUser, () => {
                if (useUserStore.getState().token !== token) return;
                clearSession();
                navigate("/login", { replace: true });
            });
        });
        return () => {
            syncScheduler.stop();
            stopSessionMonitor();
        };
    }, [navigate]);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        if (!publicSettings) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        if (!publicSettings.modelChannel.allowCustomChannel) {
            openConfigDialog(false);
            message.error("后台未允许用户自定义渠道，请联系管理员进行配置");
            return;
        }
        updateConfig("channelMode", "local");
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        if (apiKey) updateConfig("apiKey", apiKey);
        openConfigDialog(false);
    }, [message, openConfigDialog, publicSettings, updateConfig]);

    return <>{children}</>;
}
