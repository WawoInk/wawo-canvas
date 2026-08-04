"use client";

import { GithubOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

type GitHubLinkProps = {
    className?: string;
    style?: React.CSSProperties;
};

export function GitHubLink({ className, style }: GitHubLinkProps) {
    const { t } = useTranslation();

    return (
        <a
            className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-full text-stone-600 transition hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white", className)}
            style={style}
            href="https://github.com/basketikun/infinite-canvas"
            target="_blank"
            rel="noreferrer"
            aria-label={t("common.github")}
            title={t("common.github")}
        >
            <GithubOutlined className="text-base" />
        </a>
    );
}
