"use client";

import { BrandLogo } from "@/components/layout/brand-logo";
import { Menu } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { navigationToolsForUser, type NavigationToolSlug } from "@/constant/navigation-tools";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { appPathname } from "@/i18n";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/stores/use-user-store";
import { useState } from "react";

export function AppTopNav() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const appPath = appPathname(pathname);
    const hideHeader = /^\/canvas\/[^/]+/.test(appPath);
    const slug = appPath.split("/").filter(Boolean)[0];
    const user = useUserStore((state) => state.user);
    const tools = navigationToolsForUser(user);
    const activeToolSlug = tools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;
    const isAdmin = user?.role === "admin";

    return (
        <>
            {!hideHeader ? (
                <header className="sticky top-0 z-20 h-16 shrink-0 border-b border-border bg-background/90 backdrop-blur-xl">
                    <div className="mx-auto flex h-full max-w-7xl items-stretch justify-between gap-5 px-6">
                        <div className="flex min-w-0 items-center">
                            <Link to="/" className="flex h-full shrink-0 items-center gap-2 transition" aria-label={t("navigation.brandHome")}>
                                <BrandLogo height={64} />
                            </Link>

                            <button
                                type="button"
                                className="ml-3 inline-flex size-8 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground md:hidden"
                                onClick={() => setMobileNavOpen(true)}
                                aria-label={t("navigation.openMenu")}
                                title={t("navigation.menu")}
                            >
                                <Menu className="size-5" />
                            </button>

                            <nav className="hide-scrollbar ml-8 hidden h-16 min-w-0 items-center gap-7 overflow-x-auto md:flex">
                                {tools.map((tool) => {
                                    const Icon = tool.icon;
                                    const active = tool.slug === activeToolSlug;
                                    return (
                                        <Link
                                            key={tool.slug}
                                            to={`/${tool.slug}`}
                                            className={cn(
                                                "relative flex h-16 shrink-0 items-center gap-2 text-sm leading-6 transition after:absolute after:inset-x-0 after:bottom-0 after:h-px",
                                                active ? "font-medium !text-foreground after:bg-accent" : "!text-muted-foreground after:bg-transparent hover:!text-foreground",
                                            )}
                                        >
                                            <Icon className="size-4" />
                                            <span className="truncate">{t(tool.labelKey)}</span>
                                        </Link>
                                    );
                                })}
                            </nav>
                        </div>

                        <div className="my-auto flex h-9 min-w-0 items-center justify-end gap-2 justify-self-end whitespace-nowrap">
                            <UserStatusActions />
                        </div>
                    </div>
                </header>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
            {isAdmin ? <AppConfigModal /> : null}
        </>
    );
}
