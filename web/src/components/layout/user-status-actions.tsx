"use client";

import type { CSSProperties, RefObject } from "react";
import { Avatar, Dropdown, Tooltip } from "antd";
import { CircleUserRound, Keyboard, LogOut, Settings2, Shield } from "lucide-react";
import type { ItemType } from "antd/es/menu/interface";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { CreditSymbol } from "@/constant/credits";
import { canvasThemes } from "@/lib/canvas-theme";
import { formatDecimal } from "@/lib/decimal";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    accountOpen?: boolean;
    onAccountOpenChange?: (open: boolean) => void;
    accountRef?: RefObject<HTMLDivElement | null>;
    getPopupContainer?: (node: HTMLElement) => HTMLElement;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts, accountOpen, onAccountOpenChange, accountRef, getPopupContainer }: UserStatusActionsProps) {
    const { t } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const user = useUserStore((state) => state.user);
    const logout = useUserStore((state) => state.clearSession);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvasTheme = canvasThemes[theme];
    const userName = user?.displayName || user?.username || "";
    const credits = user?.credits ?? "0";
    const avatarUrl = user?.avatarUrl?.trim();
    const avatarText = (userName.trim()[0] || "U").toUpperCase();
    const naturalIconClass = "inline-flex size-7 shrink-0 items-center justify-center text-muted-foreground transition hover:text-foreground [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const avatarStyle: CSSProperties | undefined = variant === "canvas" ? { borderColor: canvasTheme.toolbar.border, color: canvasTheme.node.text, background: "transparent" } : undefined;
    const menuItems: ItemType[] = [
        { key: "user", disabled: true, label: <span className="font-medium text-current">{userName}</span> },
        { key: "account", icon: <CircleUserRound className="size-4" />, label: <Link to="/account">{t("common.accountSettings")}</Link> },
        ...(user?.role === "admin" ? [{ key: "admin", icon: <Shield className="size-4" />, label: <Link to="/admin">{t("common.adminConsole")}</Link> }] : []),
        ...(onOpenShortcuts ? [{ key: "shortcuts", icon: <Keyboard className="size-4" />, label: t("common.keyboardShortcuts"), onClick: onOpenShortcuts }] : []),
        { type: "divider" },
        { key: "logout", icon: <LogOut className="size-4" />, label: t("common.logout"), onClick: logout },
    ];

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {showConfig && user?.role === "admin" ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label={t("common.configuration")} title={t("common.configuration")}>
                    <Settings2 className="size-4" />
                </button>
            ) : null}
            <LanguageSwitcher className={naturalIconClass} style={iconStyle} getPopupContainer={getPopupContainer} />
            <AnimatedThemeToggler
                theme={theme}
                onThemeChange={setTheme}
                className={naturalIconClass}
                style={iconStyle}
                aria-label={theme === "dark" ? t("common.switchToLightTheme") : t("common.switchToDarkTheme")}
                title={theme === "dark" ? t("common.switchToLightTheme") : t("common.switchToDarkTheme")}
            />
            {variant === "canvas" && user ? (
                <Tooltip title={t("common.currentCredits")} placement="bottom">
                    <div className="flex h-8 shrink-0 items-center gap-1.5 px-1.5 text-xs font-medium tabular-nums opacity-75 transition hover:opacity-100" style={{ color: canvasTheme.node.text }}>
                        <CreditSymbol className="text-sm leading-none" />
                        <span>{formatDecimal(credits)}</span>
                    </div>
                </Tooltip>
            ) : null}
            {!user && onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label={t("common.keyboardShortcuts")} title={t("common.keyboardShortcuts")}>
                    <Keyboard className="size-4" />
                </button>
            ) : null}
            {!user ? (
                <Link to="/login" className="px-1.5 text-sm font-medium !text-muted-foreground underline-offset-4 transition hover:!text-foreground hover:underline" style={iconStyle}>
                    {t("common.login")}
                </Link>
            ) : null}
            {user ? (
                <div ref={accountRef}>
                    <Dropdown open={accountOpen} onOpenChange={onAccountOpenChange} trigger={["click"]} placement="bottomRight" getPopupContainer={getPopupContainer} styles={{ root: { minWidth: 150 } }} menu={{ items: menuItems }}>
                        <button type="button" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-transparent p-0 text-[0] leading-[0] transition" aria-label={t("common.accountMenu")}>
                            <Avatar
                                size={24}
                                src={avatarUrl ? <img src={avatarUrl} alt={userName} referrerPolicy="no-referrer" /> : undefined}
                                alt={userName}
                                className="!flex !items-center !justify-center border border-stone-300 bg-transparent text-[11px] font-semibold text-muted-foreground transition hover:border-stone-500 hover:text-foreground dark:border-stone-700 dark:hover:border-stone-400"
                                style={avatarStyle}
                            >
                                {avatarText}
                            </Avatar>
                        </button>
                    </Dropdown>
                </div>
            ) : null}
        </div>
    );
}
