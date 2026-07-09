import type { CSSProperties } from "react";
import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

const oceanic = {
    light: {
        primary: "#0A6CFE",
        primaryHover: "#0586FD",
        primaryText: "#ffffff",
        menuBg: "#EEF5FF",
        menuText: "#060F30",
        selectActiveBg: "#EEF5FF",
        selectSelectedBg: "rgba(10,108,254,0.12)",
        selectText: "#060F30",
        tableSelectedBg: "rgba(1,199,253,0.10)",
        tableSelectedHoverBg: "rgba(1,199,253,0.16)",
    },
    dark: {
        primary: "#0A6CFE",
        primaryHover: "#0586FD",
        primaryText: "#ffffff",
        menuBg: "#12204D",
        menuText: "#FDFDFD",
        selectActiveBg: "#12204D",
        selectSelectedBg: "rgba(10,108,254,0.18)",
        selectText: "#FDFDFD",
        tableSelectedBg: "rgba(1,199,253,0.10)",
        tableSelectedHoverBg: "rgba(1,199,253,0.16)",
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
            colorBgLayout: dark ? "#060F30" : "#F7FAFF",
            colorBgContainer: dark ? "#0B163D" : "#FFFFFF",
            colorBgElevated: dark ? "#12204D" : "#FFFFFF",
            colorBorder: dark ? "#1D3A68" : "#D7E5FF",
            colorBorderSecondary: dark ? "rgba(29,58,104,0.6)" : "#EEF5FF",
            colorText: dark ? "#FDFDFD" : "#060F30",
            colorTextSecondary: dark ? "#B8C7E8" : "#34466D",
            colorTextTertiary: dark ? "#7183A8" : "#64748B",
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
