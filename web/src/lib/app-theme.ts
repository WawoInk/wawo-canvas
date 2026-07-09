import type { CSSProperties } from "react";
import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

// ponytail: Warm Studio — 暖象牙纸感 + 铜色点缀，logo 蓝降为第二强调色
// 浅色 #FAF7F2 暖白纸底，深色 #14110F 暖木炭底
const oceanic = {
    light: {
        primary: "#C26B3E",
        primaryHover: "#A85A32",
        primaryText: "#FAF7F2",
        menuBg: "#F3EFE9",
        menuText: "#2D2420",
        selectActiveBg: "#F3EFE9",
        selectSelectedBg: "rgba(194,107,62,0.10)",
        selectText: "#2D2420",
        tableSelectedBg: "rgba(194,107,62,0.06)",
        tableSelectedHoverBg: "rgba(194,107,62,0.10)",
    },
    dark: {
        primary: "#E8956A",
        primaryHover: "#F0B898",
        primaryText: "#14110F",
        menuBg: "rgba(232,149,106,0.14)",
        menuText: "#EDE4DA",
        selectActiveBg: "rgba(255,255,255,0.06)",
        selectSelectedBg: "rgba(232,149,106,0.20)",
        selectText: "#EDE4DA",
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
            colorBgLayout: dark ? "#14110F" : "#FAF7F2",
            colorBgContainer: dark ? "#1C1816" : "#FFFFFF",
            colorBgElevated: dark ? "#221E1B" : "#FFFFFF",
            colorBorder: dark ? "#2E2824" : "#E8E2D9",
            colorBorderSecondary: dark ? "rgba(255,255,255,0.04)" : "#F3EFE9",
            colorText: dark ? "#EDE4DA" : "#2D2420",
            colorTextSecondary: dark ? "#A89D93" : "#6B5E55",
            colorTextTertiary: dark ? "#6B6058" : "#9C8E84",
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
