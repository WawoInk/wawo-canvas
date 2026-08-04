# Agent Implementation

## Root Cause Reproduction

The Canvas Store uses Zustand persist with asynchronous account-scoped storage. Zustand starts each `storage.setItem` but does not serialize independent mutations. A deliberately blocked older write and an immediately completed newer write leave the older JSON as the final durable value once the first write is released. Fresh hydration then restores the stale Canvas Project Replica.

The permanent Slice 1 regression test exercises only public Store mutations and account-scoped hydration while mocking the browser storage boundary.

## Slice 1 Implementation

`createAccountStorage` now captures the account-scoped key at invocation time and serializes `setItem` and `removeItem` operations for that key. Separate accounts retain separate queues, while a delayed older snapshot can no longer overwrite a newer snapshot.

## Slice 2 Implementation

Account storage exposes an awaitable per-key `flush`. `useCanvasStore.updateProject` is now a public durable mutation returning `Promise<void>`, and `waitForLocalPersistence` lets the sync worker wait for all queued writes for the current account. The worker waits first, then re-reads the project and starts POST/PUT/DELETE, so it cannot send a state newer than the durable local Replica.

## Slice 3 Implementation

`commitCanvasVideoResult` maps a materialized platform file into the target Canvas video node, awaits the Store's durable `updateProject`, and only then returns the committed node list. Both first-party and compatibility video polling success branches await this operation before publishing successful nodes into page state.

## Slice 4 Implementation

Failed account-key writes remain visible to `flush`, so Canvas backend retry continues to return `retry` instead of sending an unpersisted snapshot. The next Store mutation chains past the rejected Promise, performs a real write, and resumes normal synchronization.

## Slice 5 Implementation

While a generated-video commit waits for storage, another accepted Canvas edit may replace the Store's nodes. The result operation now checks the current nodes reference after each durable write and reapplies the video result to the newer nodes until its committed list remains current. This preserves both the new edit and the materialized video result without changing `localVersion`, revision, or CAS rules.

## Final Behavior

1. Canvas mutations enqueue account-scoped writes in order.
2. Public `updateProject` callers can await local durability.
3. Backend create/update/delete waits for the local Canvas queue and re-reads current state.
4. A failed local write blocks backend retry until a later local write succeeds.
5. Video success is published only after its file metadata is durable, and concurrent accepted edits are preserved.
6. A dirty 120-node Replica remains recoverable when a normal PUT is in flight and the page is closed without relying on unload delivery.
