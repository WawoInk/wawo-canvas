export function imageBackgroundFields(background?: string) {
    return background === "transparent" ? { background: "transparent" as const } : {};
}
