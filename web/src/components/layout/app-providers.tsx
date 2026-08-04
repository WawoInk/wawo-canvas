"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { ProConfigProvider } from "@ant-design/pro-components";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App, ConfigProvider } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/en";
import "dayjs/locale/zh-cn";
import { useTranslation } from "react-i18next";

import { resolveLanguage } from "@/i18n";
import { getAntThemeConfig } from "@/lib/app-theme";
import { sessionChanged } from "@/lib/account-storage";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            retry: false,
            refetchOnWindowFocus: false,
        },
    },
});

export function AppProviders({ children }: { children: ReactNode }) {
    const { i18n } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    const dark = theme === "dark";
    const language = resolveLanguage(i18n.resolvedLanguage || i18n.language);
    const antLocale = language === "en-US" ? enUS : zhCN;

    useEffect(() => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.style.colorScheme = theme;
    }, [dark, theme]);

    useEffect(() => {
        document.documentElement.lang = language;
        dayjs.locale(language === "en-US" ? "en" : "zh-cn");
    }, [language]);

    useEffect(() => {
        let previous = { token: useUserStore.getState().token, userId: useUserStore.getState().user?.id };
        return useUserStore.subscribe((state) => {
            const current = { token: state.token, userId: state.user?.id };
            if (sessionChanged(previous, current)) queryClient.clear();
            previous = current;
        });
    }, []);

    return (
        <ConfigProvider locale={antLocale} theme={getAntThemeConfig(dark)}>
            <ProConfigProvider dark={dark}>
                <App>
                    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
                </App>
            </ProConfigProvider>
        </ConfigProvider>
    );
}
