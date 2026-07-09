export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

// ponytail: 中性底 + logo 蓝高光，与 globals.css/app-theme.ts 高级感色板一致
export const canvasThemes = {
    light: {
        canvas: {
            background: "#F7F8FB",
            dot: "rgba(11,15,23,.16)",
            line: "rgba(11,15,23,.08)",
            selectionStroke: "#0A74FE",
            selectionFill: "rgba(10,116,254,.08)",
        },
        node: {
            label: "#475063",
            fill: "#FFFFFF",
            panel: "#FFFFFF",
            stroke: "#E4E7EE",
            activeStroke: "#0A74FE",
            placeholder: "#7C8595",
            text: "#0B0F17",
            muted: "#475063",
            faint: "#7C8595",
        },
        toolbar: {
            panel: "rgba(255,255,255,.96)",
            border: "#E4E7EE",
            item: "#475063",
            itemHover: "#F1F4F9",
            activeBg: "#F1F4F9",
            activeText: "#0A74FE",
        },
    },
    dark: {
        canvas: {
            background: "#0A0B0F",
            dot: "rgba(255,255,255,.08)",
            line: "rgba(255,255,255,.04)",
            selectionStroke: "#01C7FD",
            selectionFill: "rgba(1,199,253,.10)",
        },
        node: {
            label: "#9BA3B4",
            fill: "#121319",
            panel: "#121319",
            stroke: "rgba(255,255,255,0.10)",
            activeStroke: "#01C7FD",
            placeholder: "#6B7280",
            text: "#F5F6F8",
            muted: "#9BA3B4",
            faint: "#6B7280",
        },
        toolbar: {
            panel: "rgba(18,19,25,.96)",
            border: "rgba(255,255,255,0.08)",
            item: "#9BA3B4",
            itemHover: "#181A22",
            activeBg: "#181A22",
            activeText: "#01C7FD",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
