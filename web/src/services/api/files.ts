import i18n from "@/i18n";
import { isCurrentSession } from "@/lib/account-storage";
import { useUserStore } from "@/stores/use-user-store";

export async function readPlatformFileBlob(fileId: string) {
    const { token, user } = useUserStore.getState();
    if (!token || !user?.id) throw new Error(i18n.t("errors.file.readFailed", { defaultValue: "文件读取失败" }));
    const session = { token, userId: user.id };
    const response = await fetch(`/api/v1/files/${encodeURIComponent(fileId)}/content`, { headers: { Authorization: `Bearer ${token}` } });
    const current = useUserStore.getState();
    if (!isCurrentSession(session, { token: current.token, userId: current.user?.id }) || !response.ok || response.headers.get("content-type")?.includes("application/json")) {
        throw new Error(i18n.t("errors.file.readFailed", { defaultValue: "文件读取失败" }));
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error(i18n.t("errors.file.readFailed", { defaultValue: "文件读取失败" }));
    return blob;
}
