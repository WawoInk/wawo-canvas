export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

// ponytail: 极简 AI SaaS 配色，与 globals.css/app-theme.ts 色板一致
export const canvasThemes = {
    light: {
        canvas: {
            background: "#FDFEFF",
            dot: "rgba(21,25,32,.12)",
            line: "rgba(21,25,32,.06)",
            selectionStroke: "#7DD3FC",
            selectionFill: "rgba(125,211,252,.10)",
        },
        node: {
            label: "#4E596B",
            fill: "#FFFFFF",
            panel: "#FFFFFF",
            stroke: "#E6EDF3",
            activeStroke: "#7DD3FC",
            placeholder: "#8A94A6",
            text: "#151920",
            muted: "#4E596B",
            faint: "#8A94A6",
        },
        toolbar: {
            panel: "rgba(255,255,255,.96)",
            border: "#E6EDF3",
            item: "#4E596B",
            itemHover: "#F7FAFD",
            activeBg: "#F7FAFD",
            activeText: "#38BDF8",
        },
    },
    dark: {
        canvas: {
            background: "#090B10",
            dot: "rgba(255,255,255,.06)",
            line: "rgba(255,255,255,.03)",
            selectionStroke: "#38BDF8",
            selectionFill: "rgba(56,189,248,.12)",
        },
        node: {
            label: "#8A94A6",
            fill: "#11151D",
            panel: "#11151D",
            stroke: "#263241",
            activeStroke: "#38BDF8",
            placeholder: "#8A94A6",
            text: "#F8FAFC",
            muted: "#8A94A6",
            faint: "#8A94A6",
        },
        toolbar: {
            panel: "rgba(17,21,29,.96)",
            border: "#263241",
            item: "#8A94A6",
            itemHover: "#171C26",
            activeBg: "#171C26",
            activeText: "#38BDF8",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
