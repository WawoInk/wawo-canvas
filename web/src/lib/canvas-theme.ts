export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#F7FAFF",
            dot: "rgba(29,58,104,.22)",
            line: "rgba(29,58,104,.10)",
            selectionStroke: "#0A6CFE",
            selectionFill: "rgba(10,108,254,.08)",
        },
        node: {
            label: "#34466D",
            fill: "#FFFFFF",
            panel: "#FFFFFF",
            stroke: "#D7E5FF",
            activeStroke: "#0A6CFE",
            placeholder: "#64748B",
            text: "#060F30",
            muted: "#34466D",
            faint: "#64748B",
        },
        toolbar: {
            panel: "rgba(255,255,255,.96)",
            border: "#D7E5FF",
            item: "#34466D",
            itemHover: "#EEF5FF",
            activeBg: "#EEF5FF",
            activeText: "#0A6CFE",
        },
    },
    dark: {
        canvas: {
            background: "#060F30",
            dot: "rgba(29,58,104,.32)",
            line: "rgba(29,58,104,.16)",
            selectionStroke: "#01C7FD",
            selectionFill: "rgba(1,199,253,.10)",
        },
        node: {
            label: "#B8C7E8",
            fill: "#0B163D",
            panel: "#0B163D",
            stroke: "#1D3A68",
            activeStroke: "#01C7FD",
            placeholder: "#7183A8",
            text: "#FDFDFD",
            muted: "#B8C7E8",
            faint: "#7183A8",
        },
        toolbar: {
            panel: "rgba(11,22,61,.96)",
            border: "#1D3A68",
            item: "#B8C7E8",
            itemHover: "#12204D",
            activeBg: "#12204D",
            activeText: "#01C7FD",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
