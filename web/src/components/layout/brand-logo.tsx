import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/use-theme-store";

type BrandLogoProps = {
    variant?: "full" | "mark";
    height?: number;
    className?: string;
};

export function BrandLogo({ variant, height = 28, className }: BrandLogoProps) {
    const theme = useThemeStore((state) => state.theme);
    const resolved = variant ?? "full";
    const src = resolved === "full" ? `/logo-${theme === "dark" ? "dark" : "white"}-mode.svg` : "/logo-mark.svg";

    return <img key={theme} src={src} alt="Canvan" height={height} className={cn("shrink-0 select-none", className)} style={{ height, width: "auto", objectFit: "contain" }} draggable={false} />;
}
