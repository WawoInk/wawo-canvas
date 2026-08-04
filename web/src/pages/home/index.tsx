"use client";

import { ArrowRight } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { App, Button, Image, Tag } from "antd";
import { Trans, useTranslation } from "react-i18next";

import { fetchPrompts, type Prompt } from "@/services/api/prompts";
import { navigationTools } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { BorderBeam } from "@/components/ui/border-beam";

function Highlighter({ action, color, children }: { action: "highlight" | "underline"; color: string; children: ReactNode }) {
    return (
        <span className="relative inline-block px-1">
            {action === "highlight" ? (
                <span className="absolute inset-x-0 bottom-0 top-1 rounded-sm opacity-45" style={{ backgroundColor: color }} />
            ) : (
                <span className="absolute inset-x-0 bottom-0 h-1 rounded-full opacity-80" style={{ backgroundColor: color }} />
            )}
            <span className="relative font-medium text-foreground">{children}</span>
        </span>
    );
}

export default function IndexPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [primaryTool] = navigationTools;
    const [promptShowcase, setPromptShowcase] = useState<Prompt[]>([]);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewOpen, setPreviewOpen] = useState(false);

    useEffect(() => {
        void fetchPrompts({ pageSize: 12 })
            .then((data) => setPromptShowcase(data.items))
            .catch((error) => message.error(error instanceof Error ? error.message : t("home.showcase.loadError")));
    }, [message, t]);

    return (
        <main className="relative h-full overflow-y-auto bg-background bg-[radial-gradient(var(--dot-grid)_1px,transparent_1px)] [background-size:16px_16px] text-foreground dark:bg-[radial-gradient(var(--dot-grid)_1px,transparent_1px)]">
            <section className="relative mx-auto min-h-[calc(100vh-4rem)] max-w-7xl overflow-hidden px-6">
                <div className="pointer-events-none absolute left-[15%] top-24 size-20 rounded-full border border-dashed border-primary/20" />
                <div className="pointer-events-none absolute right-[23%] top-[48%] size-20 rounded-full border border-dashed border-primary/20" />

                <div className="relative flex min-h-[620px] flex-col items-center justify-center pt-10 text-center">
                    <h1 className="max-w-5xl text-balance font-[family-name:var(--font-display)] text-5xl font-medium tracking-[-0.03em] sm:text-7xl lg:text-[100px] lg:leading-[1.05]">
                        <span className="ai-title-aurora">{t("common.brand")}</span>
                    </h1>
                    <p className="mt-8 max-w-3xl text-balance text-lg leading-8 text-muted-foreground">
                        <Trans
                            i18nKey="home.hero.description"
                            values={{ brand: t("common.brand"), mediaTypes: t("home.hero.mediaTypes") }}
                            components={{
                                brand: (
                                    <Highlighter action="underline" color="#C26B3E">
                                        {null}
                                    </Highlighter>
                                ),
                                media: (
                                    <Highlighter action="highlight" color="#E8956A">
                                        {null}
                                    </Highlighter>
                                ),
                            }}
                        />
                    </p>
                    <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                        <div className="relative rounded-[10px] overflow-hidden">
                            <Button type="primary" size="large" href={`/${primaryTool.slug}`} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                                {t("home.hero.start")}
                            </Button>
                            <BorderBeam size={200} duration={6} colorFrom="#E8956A" colorTo="#F0B898" />
                        </div>
                        <Button size="large" href="/canvas">
                            {t("home.hero.openCanvas")}
                        </Button>
                    </div>
                </div>

                <section className="relative mx-auto mb-20 max-w-6xl border-t border-border pt-12 dark:border-border">
                    <div className="mb-8 grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-start">
                        <div />
                        <div className="max-w-2xl text-center">
                            <h2 className="text-3xl font-semibold text-foreground">{t("home.showcase.title")}</h2>
                            <p className="mt-3 text-base leading-7 text-muted-foreground">{t("home.showcase.description")}</p>
                        </div>
                        <Button type="link" href="/prompts" className="justify-self-center md:justify-self-end" icon={<ArrowRight className="size-4" />} iconPlacement="end">
                            {t("home.showcase.browsePrompts")}
                        </Button>
                    </div>
                    <div className="grid auto-rows-[210px] gap-4 md:grid-cols-4">
                        {promptShowcase.map((item, index) => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                    setPreviewIndex(index);
                                    setPreviewOpen(true);
                                }}
                                className={cn(
                                    "group relative cursor-pointer overflow-hidden border border-border bg-card text-left dark:border-border dark:bg-surface-elevated",
                                    index === 0 && "md:col-span-2 md:row-span-2",
                                    index === 3 && "md:col-span-2",
                                )}
                            >
                                <img src={item.coverUrl} alt={item.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/35 to-transparent p-4 text-white">
                                    <div className="mb-2 flex flex-wrap gap-1.5">
                                        {item.tags.slice(0, 2).map((tag) => (
                                            <Tag key={tag} variant="filled" className="m-0 bg-white/15 text-[11px] text-white backdrop-blur">
                                                {tag}
                                            </Tag>
                                        ))}
                                    </div>
                                    <h3 className="text-sm font-medium">{item.title}</h3>
                                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/75">{item.prompt}</p>
                                </div>
                            </button>
                        ))}
                    </div>
                </section>
            </section>
            <Image.PreviewGroup
                preview={{
                    open: previewOpen,
                    current: previewIndex,
                    onOpenChange: setPreviewOpen,
                    onChange: setPreviewIndex,
                }}
            >
                <div className="hidden">
                    {promptShowcase.map((item) => (
                        <Image key={item.id} src={item.coverUrl} alt={item.title} />
                    ))}
                </div>
            </Image.PreviewGroup>
        </main>
    );
}
