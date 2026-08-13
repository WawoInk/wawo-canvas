const SESSION_CHECK_MS = 60_000;

type SessionUser = { role: string };
type SessionIdentity = { token: string; userId?: string };

function persistedSession(value: string | null): SessionIdentity {
    try {
        const state = JSON.parse(value || "")?.state;
        return { token: state?.token || "", userId: state?.user?.id };
    } catch {
        return { token: "" };
    }
}

export async function revalidateSession(token: string, fetchUser: (token: string) => Promise<SessionUser>, clearSession: () => void) {
    if (!token) return;
    try {
        if ((await fetchUser(token)).role === "guest") clearSession();
    } catch {
        // Network failures are not proof that the session expired.
    }
}

export function startSessionMonitor(validate: () => Promise<void>) {
    const check = () => void validate();
    const onVisibilityChange = () => {
        if (document.visibilityState === "visible") check();
    };
    const interval = setInterval(check, SESSION_CHECK_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
        clearInterval(interval);
        document.removeEventListener("visibilitychange", onVisibilityChange);
    };
}

export function startAuthStorageMonitor(storageKey: string, getSession: () => SessionIdentity, onSessionChange: (current: SessionIdentity, next: SessionIdentity) => void) {
    const onStorage = (event: StorageEvent) => {
        if (event.key !== storageKey) return;
        const current = getSession();
        const next = persistedSession(event.newValue);
        if (current.token !== next.token || current.userId !== next.userId) onSessionChange(current, next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
}
