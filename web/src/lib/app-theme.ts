import type { CSSProperties } from "react";
import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

// ponytail: 高级感中性深空底 + logo 蓝高光（Linear/Vercel 质感）
// 深色用近黑中性底替代之前的浊蓝底；边框改白色低透替代厚蓝边，避免 SaaS 廉价感
const oceanic = {
    light: {
        primary: "#0A74FE",
        primaryHover: "#0868E0",
        primaryText: "#ffffff",
        menuBg: "#F1F4F9",
        menuText: "#0B0F17",
        selectActiveBg: "#F1F4F9",
        selectSelectedBg: "rgba(10,116,254,0.10)",
        selectText: "#0B0F17",
        tableSelectedBg: "rgba(10,116,254,0.06)",
        tableSelectedHoverBg: "rgba(10,116,254,0.10)",
    },
    dark: {
        primary: "#0A74FE",
        primaryHover: "#3B8BFF",
        primaryText: "#ffffff",
        menuBg: "rgba(10,116,254,0.14)",
        menuText: "#F5F6F8",
        selectActiveBg: "rgba(255,255,255,0.06)",
        selectSelectedBg: "rgba(10,116,254,0.20)",
        selectText: "#F5F6F8",
        tableSelectedBg: "rgba(255,255,255,0.04)",
        tableSelectedHoverBg: "rgba(255,255,255,0.07)",
    },
};

export const adminLayoutStyle = {
    siderWidth: 232,
    headerHeight: 56,
    brandHeight: 64,
    menu: { borderInlineEnd: 0, padding: "18px 12px", fontSize: 15 } satisfies CSSProperties,
    menuItem: { height: 44, lineHeight: "44px", marginBlock: 4, borderRadius: 8 } satisfies CSSProperties,
};

export function getAntThemeConfig(dark: boolean): ThemeConfig {
    const color = dark ? oceanic.dark : oceanic.light;

    return {
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: { key: dark ? "infinite-canvas-dark" : "infinite-canvas-light" },
        token: {
            colorPrimary: color.primary,
            colorInfo: color.primary,
            colorLink: color.primary,
            colorLinkHover: color.primaryHover,
            colorLinkActive: color.primary,
            colorTextLightSolid: color.primaryText,
            colorBgLayout: dark ? "#0A0B0F" : "#F7F8FB",
            colorBgContainer: dark ? "#121319" : "#FFFFFF",
            colorBgElevated: dark ? "#181A22" : "#FFFFFF",
            colorBorder: dark ? "rgba(255,255,255,0.08)" : "#E4E7EE",
            colorBorderSecondary: dark ? "rgba(255,255,255,0.05)" : "#EEF1F6",
            colorText: dark ? "#F5F6F8" : "#0B0F17",
            colorTextSecondary: dark ? "#9BA3B4" : "#475063",
            colorTextTertiary: dark ? "#6B7280" : "#7C8595",
            colorSuccess: "#16C784",
            colorWarning: "#FFB020",
            colorError: "#FF4D6D",
            borderRadius: 10,
            borderRadiusLG: 16,
        },
        components: {
            Button: {
                primaryShadow: "none",
            },
            Menu: {
                itemActiveBg: color.menuBg,
                itemHoverBg: color.menuBg,
                itemSelectedBg: color.menuBg,
                itemSelectedColor: color.menuText,
                darkItemHoverBg: oceanic.dark.menuBg,
                darkItemSelectedBg: oceanic.dark.menuBg,
                darkItemSelectedColor: oceanic.dark.menuText,
            },
            Select: {
                optionActiveBg: color.selectActiveBg,
                optionSelectedBg: color.selectSelectedBg,
                optionSelectedColor: color.selectText,
            },
            Table: {
                rowSelectedBg: color.tableSelectedBg,
                rowSelectedHoverBg: color.tableSelectedHoverBg,
            },
        },
    };
}
