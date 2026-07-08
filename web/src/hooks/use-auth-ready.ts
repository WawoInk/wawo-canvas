"use client";

import { useUserStore } from "@/stores/use-user-store";

/** ponytail: single hook for "is auth fully hydrated", reused everywhere that guards on token */
export function useAuthReady() {
    const token = useUserStore((s) => s.token);
    const userId = useUserStore((s) => s.user?.id);
    const isReady = useUserStore((s) => s.isReady);
    return Boolean(isReady && token && userId);
}
