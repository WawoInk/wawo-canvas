import { Home } from "lucide-react";
import { Link } from "react-router-dom";

export default function NotFound() {
    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
            <main className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-background bg-[radial-gradient(#E4E7EE_1px,transparent_1px)] px-6 py-10 text-foreground [background-size:16px_16px] dark:bg-[radial-gradient(rgba(255,255,255,.06)_1px,transparent_1px)]">
                <section className="w-full max-w-md text-center">
                    <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-lg border border-border bg-card text-2xl font-semibold text-primary shadow-sm dark:border-border dark:bg-surface-elevated">404</div>
                    <h1 className="text-3xl font-semibold tracking-normal">页面不存在</h1>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">这个地址没有对应的页面，可能已经移动或被合并到其他入口。</p>
                    <div className="mt-8 flex flex-wrap justify-center gap-3">
                        <Link to="/" className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/80">
                            <Home className="size-4" />
                            返回首页
                        </Link>
                    </div>
                </section>
            </main>
        </div>
    );
}
