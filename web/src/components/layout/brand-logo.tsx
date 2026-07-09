import { useThemeStore } from "@/stores/use-theme-store";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
    variant?: "full" | "mark";
    height?: number;
    className?: string;
};

export function BrandLogo({ variant, height = 22, className }: BrandLogoProps) {
    const dark = useThemeStore((state) => state.theme) === "dark";
    const resolved = variant ?? (dark ? "full" : "mark");
    const src = resolved === "full" ? "/logo.svg" : "/logo-mark.svg";

    return (
        <img
            src={src}
            alt="Canvan"
            height={height}
            className={cn("shrink-0 select-none", className)}
            style={{ height, width: "auto", objectFit: "contain" }}
            draggable={false}
        />
    );
}
