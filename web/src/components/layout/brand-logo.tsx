import { cn } from "@/lib/utils";

type BrandLogoProps = {
    variant?: "full" | "mark";
    height?: number;
    className?: string;
};

export function BrandLogo({ variant, height = 28, className }: BrandLogoProps) {
    const resolved = variant ?? "full";
    const src = resolved === "full" ? "/logo.svg" : "/logo-mark.svg";

    return <img src={src} alt="Canvan" height={height} className={cn("shrink-0 select-none", className)} style={{ height, width: "auto", objectFit: "contain" }} draggable={false} />;
}
