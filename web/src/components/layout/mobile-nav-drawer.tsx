"use client";

import { Drawer } from "antd";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import type { navigationToolsForUser, NavigationToolSlug } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";

type MobileNavDrawerProps = {
    open: boolean;
    tools: ReturnType<typeof navigationToolsForUser>;
    activeToolSlug?: NavigationToolSlug;
    onClose: () => void;
};

export function MobileNavDrawer({ open, tools, activeToolSlug, onClose }: MobileNavDrawerProps) {
    const { t } = useTranslation();
    return (
        <Drawer title={t("navigation.title")} placement="left" size={280} open={open} onClose={onClose} className="md:hidden">
            <div className="space-y-1">
                {tools.map((tool) => {
                    const Icon = tool.icon;
                    const active = tool.slug === activeToolSlug;
                    return (
                        <Link
                            key={tool.slug}
                            to={`/${tool.slug}`}
                            onClick={onClose}
                            className={cn("flex items-center gap-3 rounded-lg px-3 py-3 text-base transition", active ? "bg-accent font-medium !text-foreground" : "!text-muted-foreground hover:bg-accent hover:!text-foreground")}
                        >
                            <Icon className="size-5" />
                            <span>{t(tool.labelKey)}</span>
                        </Link>
                    );
                })}
            </div>
        </Drawer>
    );
}
