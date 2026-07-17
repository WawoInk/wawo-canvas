import type { CSSProperties } from "react";
import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

// ponytail: 极简 AI SaaS 配色（Linear/Vercel 质感）
// 大量留白，低饱和，淡蓝高光
const oceanic = {
    light: {
        primary: "#151920",
        primaryHover: "#2D3748",
        primaryText: "#ffffff",
        menuBg: "#F7FAFD",
        menuText: "#151920",
        selectActiveBg: "#F7FAFD",
        selectSelectedBg: "rgba(125,211,252,0.12)",
        selectText: "#151920",
        tableSelectedBg: "rgba(125,211,252,0.08)",
        tableSelectedHoverBg: "rgba(125,211,252,0.12)",
    },
    dark: {
        primary: "#38BDF8",
        primaryHover: "#7DD3FC",
        primaryText: "#090B10",
        menuBg: "rgba(56,189,248,0.14)",
        menuText: "#F8FAFC",
        selectActiveBg: "rgba(255,255,255,0.06)",
        selectSelectedBg: "rgba(56,189,248,0.20)",
        selectText: "#F8FAFC",
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
            colorBgLayout: dark ? "#090B10" : "#FDFEFF",
            colorBgContainer: dark ? "#11151D" : "#FFFFFF",
            colorBgElevated: dark ? "#171C26" : "#FFFFFF",
            colorBorder: dark ? "#263241" : "#E6EDF3",
            colorBorderSecondary: dark ? "rgba(38,50,65,0.6)" : "#EEF1F6",
            colorText: dark ? "#F8FAFC" : "#151920",
            colorTextSecondary: dark ? "#8A94A6" : "#4E596B",
            colorTextTertiary: dark ? "#8A94A6" : "#8A94A6",
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
