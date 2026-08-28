export type VolcengineAssetBatchResult = {
    total: number;
    successCount: number;
    failedCount: number;
    firstError?: unknown;
};

export async function runVolcengineAssetBatch<T>(assets: T[], register: (asset: T) => Promise<unknown>): Promise<VolcengineAssetBatchResult> {
    let successCount = 0;
    let firstError: unknown;
    for (const asset of assets) {
        try {
            await register(asset);
            successCount += 1;
        } catch (error) {
            firstError ??= error;
        }
    }
    return { total: assets.length, successCount, failedCount: assets.length - successCount, ...(firstError === undefined ? {} : { firstError }) };
}
