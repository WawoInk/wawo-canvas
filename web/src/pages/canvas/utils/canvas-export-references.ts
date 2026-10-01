export function collectCanvasExportReferences(value: unknown, references = { storageKeys: new Set<string>(), fileIds: new Set<string>() }) {
    if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        if (typeof record.fileId === "string" && record.fileId) references.fileIds.add(record.fileId);
        else if (typeof record.storageKey === "string" && record.storageKey.includes(":")) references.storageKeys.add(record.storageKey);
        Object.values(value).forEach((item) => collectCanvasExportReferences(item, references));
    }
    return references;
}
