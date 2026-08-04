export const generationTaskStatuses = {
    queued: { labelKey: "admin.generationTasks.statuses.queued", color: "default" },
    pending: { labelKey: "admin.generationTasks.statuses.pending", color: "default" },
    running: { labelKey: "admin.generationTasks.statuses.running", color: "processing" },
    success: { labelKey: "admin.generationTasks.statuses.success", color: "success" },
    succeeded: { labelKey: "admin.generationTasks.statuses.success", color: "success" },
    failed: { labelKey: "admin.generationTasks.statuses.failed", color: "error" },
    cancelled: { labelKey: "admin.generationTasks.statuses.cancelled", color: "warning" },
} as const;

export function generationTaskStatus(status: string) {
    return generationTaskStatuses[status as keyof typeof generationTaskStatuses] || { labelKey: "admin.generationTasks.statuses.unknown", color: "default" };
}
