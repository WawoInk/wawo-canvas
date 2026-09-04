"use client";

import { Suspense, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App, Button } from "antd";
import { Download, FileUp, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatNumber } from "@/i18n/formatters";
import { readZip } from "@/lib/zip";
import { CanvasDeleteProjectsDialog } from "./components/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "./components/canvas-project-card";
import type { CanvasExportFile } from "./export-types";
import { useCanvasStore } from "./stores/use-canvas-store";
import { useCanvasUiStore } from "./stores/use-canvas-ui-store";
import { exportCanvasProjects } from "./utils/canvas-export";
import { restoreCanvasExportFiles } from "./utils/canvas-import";
import { useUserStore } from "@/stores/use-user-store";

export default function Page() {
    const { t } = useTranslation();

    return (
        <Suspense fallback={<main className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">{t("canvas.library.states.loading")}</main>}>
            <CanvasPage />
        </Suspense>
    );
}

function CanvasPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const syncFromBackend = useCanvasStore((state) => state.syncFromBackend);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const user = useUserStore((state) => state.user);

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const agentQuery = agentMode ? `?${searchParams.toString()}` : "";
    const enterProject = (id: string) => {
        navigate(`/canvas/${id}${agentQuery}`);
    };
    const createAndEnter = () => enterProject(createProject(t("canvas.library.project.defaultTitle", { index: formatNumber(projects.length + 1, { useGrouping: false }) })));
    const importCanvas = async (file?: File) => {
        if (!file) return;
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
            await restoreCanvasExportFiles(data, zip);
            data.projects.forEach((item) => importProject(item.project));
            message.success(t("canvas.library.messages.importSuccess", { count: data.projects.length, value: formatNumber(data.projects.length) }));
        } catch {
            message.error(t("canvas.library.errors.importFailed"));
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    useEffect(() => {
        if (!hydrated || autoOpenRef.current || (mode !== "new" && mode !== "recent")) return;
        autoOpenRef.current = true;
        const defaultTitle = t("canvas.library.project.defaultTitle", { index: formatNumber(projects.length + 1, { useGrouping: false }) });
        enterProject(mode === "new" ? createProject(defaultTitle) : projects[0]?.id || createProject(defaultTitle));
    }, [createProject, hydrated, mode, projects, t]);

    // Sync from backend when hydrated and user is logged in
    useEffect(() => {
        if (hydrated && user?.id) {
            void syncFromBackend();
        }
    }, [hydrated, user?.id, syncFromBackend]);

    if (hydrated && (mode === "new" || mode === "recent")) return <main className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">{t("canvas.library.states.opening")}</main>;

    return (
        <main className="h-full overflow-auto bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-6">
                    <div>
                        <p className="text-xs text-muted-foreground">{t("canvas.library.header.eyebrow")}</p>
                        <h1 className="mt-3 text-3xl font-semibold">{t("canvas.library.header.title")}</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        {selectedIds.length ? (
                            <>
                                <Button
                                    disabled={!hydrated}
                                    icon={<Download className="size-4" />}
                                    onClick={() =>
                                        void exportCanvasProjects(
                                            projects.filter((project) => selectedIds.includes(project.id)),
                                            t("canvas.library.project.selectedExportFileName", { count: selectedIds.length, value: formatNumber(selectedIds.length) }),
                                        )
                                    }
                                >
                                    {t("canvas.library.actions.exportSelected")}
                                </Button>
                                <Button disabled={!hydrated} onClick={() => setDeleteIds(selectedIds)}>
                                    {t("canvas.library.actions.deleteSelected")}
                                </Button>
                            </>
                        ) : null}
                        {projects.length ? (
                            <Button disabled={!hydrated} onClick={() => setDeleteIds(projects.map((project) => project.id))}>
                                {t("canvas.library.actions.deleteAll")}
                            </Button>
                        ) : null}
                        <Button disabled={!hydrated} icon={<FileUp className="size-4" />} onClick={() => inputRef.current?.click()}>
                            {t("canvas.library.actions.import")}
                        </Button>
                        <Button disabled={!hydrated} type="primary" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                            {t("canvas.library.actions.create")}
                        </Button>
                    </div>
                </header>

                {!hydrated ? (
                    <section className="flex min-h-[360px] items-center justify-center border-y text-sm text-muted-foreground">{t("canvas.library.states.loadingProjects")}</section>
                ) : projects.length ? (
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                        {projects.map((project) => (
                            <CanvasProjectCard key={project.id} project={project} />
                        ))}
                    </div>
                ) : (
                    <section className="flex min-h-[360px] flex-col items-center justify-center border-y text-center">
                        <h2 className="text-xl font-medium">{t("canvas.library.empty.title")}</h2>
                        <p className="mt-3 text-sm text-muted-foreground">{t("canvas.library.empty.description")}</p>
                        <Button type="primary" className="mt-6" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                            {t("canvas.library.actions.create")}
                        </Button>
                    </section>
                )}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <CanvasDeleteProjectsDialog />
        </main>
    );
}
