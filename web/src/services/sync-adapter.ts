// web/src/services/sync-adapter.ts
// ponytail: two sync mechanisms exist (cursor-based REST + WebDAV full-snapshot),
// so the seam is real. One adapter = hypothetical, two = earned.

export type SyncDomainData = {
    updates: any[];
    deletes: string[];
};

export type SyncDelta = {
    cursor: string;
    assets: SyncDomainData;
    canvas: SyncDomainData;
    tasks: SyncDomainData;
};

/** Interface that both cursor-sync (REST) and WebDAV sync implement. */
export interface SyncAdapter {
    /** Pull latest delta. Returns null when nothing has changed. */
    pull(): Promise<SyncDelta | null>;

    /** Push local data to remote. */
    push(data: unknown): Promise<void>;

    /** Reset local cursor / state (e.g. on user switch). */
    reset(): Promise<void>;
}
