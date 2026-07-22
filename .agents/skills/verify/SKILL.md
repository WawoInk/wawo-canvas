---
name: verify
summary: Verify the running Docker-backed app through HTTP and the Vite UI.
---

1. Use `docker compose ps` and `docker compose logs --tail=120 api`; the `api` service runs Air and reloads source changes on `127.0.0.1:8088`.
2. Verify handlers through `http://127.0.0.1:8088`; authenticate with `POST /api/admin/login` using `.env` credentials.
3. Start the frontend with preview config `vite-dev`. Vite proxies `/api` to `8088`; if port 3000 is occupied, navigate the preview to Vite's actual fallback port shown in server logs.
4. Air reload regenerates the default development JWT secret, so log in again after backend source edits.
5. For provider flows, bind a temporary local HTTP server through `host.docker.internal`, use zero model cost, then restore settings and delete generated tasks/projects.
