import { Home } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function NotFound() {
    const { t } = useTranslation();

    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
            <main className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-background bg-[radial-gradient(var(--dot-grid)_1px,transparent_1px)] px-6 py-10 text-foreground [background-size:16px_16px] dark:bg-[radial-gradient(var(--dot-grid)_1px,transparent_1px)]">
                <section className="w-full max-w-md text-center">
                    <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-lg border border-border bg-card text-2xl font-semibold text-primary shadow-sm dark:border-border dark:bg-surface-elevated">{t("notFound.code")}</div>
                    <h1 className="text-3xl font-semibold tracking-normal">{t("notFound.title")}</h1>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("notFound.description")}</p>
                    <div className="mt-8 flex flex-wrap justify-center gap-3">
                        <Link to="/" className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/80">
                            <Home className="size-4" />
                            {t("notFound.backHome")}
                        </Link>
                    </div>
                </section>
            </main>
        </div>
    );
}
