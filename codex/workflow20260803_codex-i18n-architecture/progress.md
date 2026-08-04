# Internationalization Progress

## Current

- [x] Project analysis and route strategy approved.
- [x] Clean `codex/i18n-architecture` worktree selected.
- [x] Bun dependencies installed.
- [x] Core i18n initialization and global providers.
- [x] Public shell and public pages.
- [x] Account, assets, prompts, image, and video modules.
- [x] Configuration, version checks, API fallbacks, and WebDAV synchronization.
- [x] Admin modules.
- [x] Canvas modules, online assistant, and local Agent panels.
- [x] Final hardcoded-copy audit, formatting check, tests, and build.
- [ ] User-run browser acceptance for runtime switching and persistence.

## Subagent Reports

Subagents write bounded implementation notes under `agents/` and return only a short summary to the parent task.

## Build History

- Core infrastructure: `bun run build` passed. Existing Vite chunk warnings remain unchanged.
- A pre-existing `AiConfig` test fixture was missing `imageRequestFormats`; the fixture was minimally aligned so the repository build can run.
- Public pages: `bun run build` passed.
- Account module: `bun run build` passed.
- Assets and prompts modules: `bun run build` passed; locale resources contain 454 symmetric leaf keys.
- Image workbench and shared image components: `bun run build` passed; locale resources contain 571 symmetric leaf keys.
- Video workbench and shared audio/video components: `bun run build` passed; four focused tests passed; locale resources contain 697 symmetric leaf keys.
- Configuration and WebDAV synchronization: `bun run build` passed; locale resources contain 814 symmetric leaf keys.
- Admin modules: five focused tests passed and all admin translation resources were merged.
- Canvas integration: 30 focused tests passed; each locale contains 729 Canvas leaf keys.
- Final verification: 52 tests passed, `bun run format:check` passed, static translation key misses are 0, each locale contains 2,029 symmetric leaf keys, and `bun run build` passed.
