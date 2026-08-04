"use client";

import type { CSSProperties } from "react";
import { Dropdown } from "antd";
import type { MenuProps } from "antd";
import { Check, Languages } from "lucide-react";
import { useTranslation } from "react-i18next";

import { resolveLanguage, type SupportedLanguage } from "@/i18n";

type LanguageSwitcherProps = {
    className?: string;
    style?: CSSProperties;
    getPopupContainer?: (node: HTMLElement) => HTMLElement;
};

export function LanguageSwitcher({ className, style, getPopupContainer }: LanguageSwitcherProps) {
    const { t, i18n } = useTranslation();
    const language = resolveLanguage(i18n.resolvedLanguage || i18n.language);
    const options: Array<{ key: SupportedLanguage; label: string }> = [
        { key: "zh-CN", label: t("language.options.zhCN") },
        { key: "en-US", label: t("language.options.enUS") },
    ];
    const items: MenuProps["items"] = options.map((option) => ({
        key: option.key,
        label: (
            <span className="flex min-w-24 items-center justify-between gap-3">
                <span>{option.label}</span>
                {option.key === language ? <Check className="size-4" /> : null}
            </span>
        ),
    }));

    return (
        <Dropdown
            trigger={["click"]}
            placement="bottomRight"
            getPopupContainer={getPopupContainer}
            menu={{
                items,
                selectable: true,
                selectedKeys: [language],
                onClick: ({ key }) => void i18n.changeLanguage(key),
            }}
        >
            <button type="button" className={className} style={style} aria-label={t("language.switcherLabel")} title={t("language.switcherLabel")}>
                <Languages className="size-4" />
            </button>
        </Dropdown>
    );
}
