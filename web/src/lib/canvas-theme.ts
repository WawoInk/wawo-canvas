export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

// ponytail: Warm Studio 暖色画布，与 globals.css/app-theme.ts 暖象牙/暖木炭色板一致
export const canvasThemes = {
    light: {
        canvas: {
            background: "#FAF7F2",
            dot: "rgba(45,36,32,.07)",
            line: "rgba(45,36,32,.05)",
            selectionStroke: "#C26B3E",
            selectionFill: "rgba(194,107,62,.10)",
        },
        node: {
            label: "#737373",
            fill: "#FFFFFF",
            panel: "#FFFFFF",
            stroke: "#E8E2D9",
            activeStroke: "#C26B3E",
            placeholder: "#9C8E84",
            text: "#1A1A1A",
            muted: "#737373",
            faint: "#9C8E84",
        },
        toolbar: {
            panel: "rgba(255,255,255,.96)",
            border: "#E8E2D9",
            item: "#737373",
            itemHover: "#F3EFE9",
            activeBg: "#F3EFE9",
            activeText: "#C26B3E",
        },
    },
    dark: {
        canvas: {
            background: "#14110F",
            dot: "rgba(237,228,218,.04)",
            line: "rgba(255,255,255,.02)",
            selectionStroke: "#E8956A",
            selectionFill: "rgba(232,149,106,.12)",
        },
        node: {
            label: "#A3A3A3",
            fill: "#1C1816",
            panel: "#1C1816",
            stroke: "#2E2824",
            activeStroke: "#E8956A",
            placeholder: "#6B6058",
            text: "#F0F0F0",
            muted: "#A3A3A3",
            faint: "#6B6058",
        },
        toolbar: {
            panel: "rgba(28,24,22,.96)",
            border: "#2E2824",
            item: "#A3A3A3",
            itemHover: "#221E1B",
            activeBg: "#221E1B",
            activeText: "#E8956A",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
