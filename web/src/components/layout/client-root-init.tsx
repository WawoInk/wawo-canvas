"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import i18n, { appPathname, localeFromPathname, resolveLanguage } from "@/i18n";
import { useConfigStore } from "@/stores/use-config-store";
import { importChannelCredentials, readChannelImportUrl } from "./channel-url-import";
import { useUserStore } from "@/stores/use-user-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { syncScheduler } from "@/services/sync-scheduler";
import { syncClient } from "@/services/sync-client";
import { AUTH_TOKEN_KEY, fetchCurrentUser } from "@/services/api/auth";
import { startCreditBalanceSync } from "@/services/credit-balance-sync";
import { revalidateSession, startAuthStorageMonitor, startSessionMonitor } from "@/services/session-monitor";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const pendingConfigParams = useRef<ReturnType<typeof readChannelImportUrl> | undefined>(undefined);
    const { pathname, state: locationState } = useLocation();
    const appPath = appPathname(pathname);
    const hydrateUser = useUserStore((state) => state.hydrateUser);
    const userId = useUserStore((state) => state.user?.id);
    const loadPublicSettings = useConfigStore((state) => state.loadPublicSettings);
    const configHydrated = useConfigStore((state) => state.configHydrated);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const isLoginPage = appPath === "/login" || appPath === "/admin/login";

    useEffect(() => {
        const page = seoPage(appPath);
        document.title = t(`seo.pages.${page}.title`, { defaultValue: t("seo.default.title") });
        document.querySelector('meta[name="description"]')?.setAttribute("content", t(`seo.pages.${page}.description`, { defaultValue: t("seo.default.description") }));
    }, [appPath, t]);

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
        const stopCreditBalanceSync = startCreditBalanceSync();
        const stopAuthStorageMonitor = startAuthStorageMonitor(
            AUTH_TOKEN_KEY,
            () => {
                const { token, user } = useUserStore.getState();
                return { token, userId: user?.id };
            },
            (current, next) => {
                if (current.userId !== next.userId) {
                    const language = localeFromPathname(window.location.pathname) || resolveLanguage(i18n.resolvedLanguage || i18n.language);
                    window.location.replace(`/${language}/`);
                } else window.location.reload();
            },
        );
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
            stopCreditBalanceSync();
            stopAuthStorageMonitor();
            stopSessionMonitor();
        };
    }, [navigate]);

    useEffect(() => {
        if (pendingConfigParams.current === undefined) {
            pendingConfigParams.current = readChannelImportUrl((url) => {
                void navigate(url, { replace: true, state: locationState });
            });
        }
        if (!pendingConfigParams.current) return;
        const result = importChannelCredentials(pendingConfigParams.current);
        if (result.status === "pending") return;
        pendingConfigParams.current = null;
        if (result.status === "disabled") message.error(t("errors.customChannelDisabled"));
        else if (result.status === "missing-base-url") message.error(t("config.importedChannelBaseUrlRequired", { defaultValue: "导入渠道需要提供 Base URL" }));
        else if (result.status === "invalid-base-url") message.error(t("config.importedChannelBaseUrlInvalid", { defaultValue: "渠道 Base URL 无效，请使用 HTTP 或 HTTPS 地址" }));
        else {
            openConfigDialog(false);
            if (result.status === "created") message.success(t("config.importedChannelCreated", { name: result.channelName, defaultValue: "已新增渠道：{{name}}" }));
            else message.success(t("config.importedChannelUpdated", { name: result.channelName, defaultValue: "已更新渠道：{{name}}" }));
        }
    }, [configHydrated, locationState, message, navigate, openConfigDialog, publicSettings, t]);

    return <>{children}</>;
}

export function seoPage(pathname: string) {
    if (pathname === "/") return "home";
    if (pathname === "/login" || pathname === "/admin/login") return "login";
    if (pathname === "/canvas" || pathname.startsWith("/canvas/")) return "canvas";
    if (pathname === "/image") return "image";
    if (pathname === "/storyboard/script-agent" || pathname.startsWith("/storyboard/script-agent/")) return "scriptAgent";
    if (pathname === "/storyboard" || pathname === "/storyboard/brainstorm-agent") return "storyboard";
    if (pathname === "/video") return "video";
    if (pathname === "/prompts") return "prompts";
    if (pathname === "/assets") return "assets";
    if (pathname === "/asset-library") return "assetLibrary";
    if (pathname === "/volcengine-assets") return "volcengineAssets";
    if (pathname === "/account") return "account";
    if (pathname === "/enterprise-assets") return "enterpriseAssets";
    if (pathname.startsWith("/admin")) return "admin";
    return "notFound";
}
