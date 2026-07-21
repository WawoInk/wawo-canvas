export const generationTaskStatuses = {
    queued: { label: "排队中", color: "default" },
    pending: { label: "等待中", color: "default" },
    running: { label: "运行中", color: "processing" },
    success: { label: "成功", color: "success" },
    succeeded: { label: "成功", color: "success" },
    failed: { label: "失败", color: "error" },
    cancelled: { label: "已取消", color: "warning" },
} as const;

export function generationTaskStatus(status: string) {
    return generationTaskStatuses[status as keyof typeof generationTaskStatuses] || { label: "未知", color: "default" };
}
