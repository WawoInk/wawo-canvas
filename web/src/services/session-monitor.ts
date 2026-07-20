const SESSION_CHECK_MS = 60_000;

type SessionUser = { role: string };

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
