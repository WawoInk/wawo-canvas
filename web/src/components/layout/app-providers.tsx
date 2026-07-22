"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { ProConfigProvider } from "@ant-design/pro-components";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

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
    const theme = useThemeStore((state) => state.theme);
    const dark = theme === "dark";

    useEffect(() => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.style.colorScheme = theme;
    }, [dark, theme]);

    useEffect(() => {
        let previous = { token: useUserStore.getState().token, userId: useUserStore.getState().user?.id };
        return useUserStore.subscribe((state) => {
            const current = { token: state.token, userId: state.user?.id };
            if (sessionChanged(previous, current)) queryClient.clear();
            previous = current;
        });
    }, []);

    return (
        <ConfigProvider locale={zhCN} theme={getAntThemeConfig(dark)}>
            <ProConfigProvider dark={dark}>
                <App>
                    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
                </App>
            </ProConfigProvider>
        </ConfigProvider>
    );
}
