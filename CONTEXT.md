# Infinite Canvas

Infinite Canvas is an AI creation workspace where Canvas projects compile user-authored graph inputs into durable generation work and materialized media results.

## Generation

**Model Profile**:
A stable, deployable generation choice with a defined capability and price. It is distinct from a capability template, an upstream model name, a transport channel, and a local compatibility selection.
_Avoid_: Model ID, provider model

**Unresolved Model Selection**:
A previously saved selection that cannot be mapped unambiguously to an available Model Profile. Existing content remains readable, but the selection cannot start new generation work until explicitly replaced.
_Avoid_: Best-match model, fallback model

**Generation Run**:
One durable Canvas generation attempt, connecting its graph input, Model Profile, output node, submission identity, asynchronous task, and terminal result.
_Avoid_: Request, job

**Materialized Result**:
A terminal generation result backed by a usable platform file reference. An upstream success without a platform file is not a successful Generation Run.
_Avoid_: Empty success, provider URL result

**Stop Observing**:
Pause local observation of an active Generation Run without changing its asynchronous task or terminal state.
_Avoid_: Stop generation, cancel

**Resume Observing**:
Continue observing the same durable Generation Run and task binding without submitting new generation work.
_Avoid_: Retry, restart

**Cancel Run**:
Request cancellation of an active Generation Run. The run becomes cancelled only when cancellation wins terminal arbitration.
_Avoid_: Stop observing, dismiss

**Retry Run**:
Start a new Generation Run from prior inputs while preserving the prior run's terminal history.
_Avoid_: Resume, reopen

## Canvas Projects

**Canvas Project Replica**:
A locally usable Canvas project copy whose accepted edits remain valid while offline or awaiting synchronization.
_Avoid_: Cache, server copy

**Offline Dirty**:
Local accepted project state that has not yet been durably acknowledged by a synchronization participant. It must not be discarded merely because a remote response is empty or lacks the project.
_Avoid_: Temporary state, stale copy

**Tombstone**:
A durable deletion fact for a Canvas project. Absence from a remote response is not a tombstone.
_Avoid_: Missing record, empty response

**Synchronization Participant**:
A durable remote participant in Canvas project synchronization. PostgreSQL persists synchronized project state; WebDAV participates as a merge peer rather than an authority that may erase Offline Dirty state.
_Avoid_: Source of truth, backup

## Enterprises

**Platform Role**:
The existing `guest`, `user`, or `admin` permission level. It is independent from enterprise identity; enterprise owners and members both keep the `user` platform role.
_Avoid_: Enterprise admin role

**Enterprise Owner**:
The single `owner` identity for an enterprise. The Enterprise Owner is a normal platform user who can manage that enterprise; it is not a Platform Administrator.
_Avoid_: Admin, enterprise admin

**Enterprise Member**:
A `member` identity belonging to one enterprise. An Enterprise Member has an independent login, balance, personal assets, and Canvas Project Replicas.
_Avoid_: Shared account, child session

**Account Data Boundary**:
The current authenticated user ID used to partition browser-persisted Canvas projects, personal assets, synchronization cursors, workbench history, and protected query results.
_Avoid_: Browser cache namespace

**Enterprise Shared Asset**:
An enterprise-owned asset read on demand from the enterprise API. It records its creator but does not enter personal asset persistence, incremental synchronization, or WebDAV.
_Avoid_: Shared personal asset, synchronized enterprise asset

## Brainstorm Workspace

**Brainstorm Workspace**:
An independent workspace for developing ideas without a Storyboard Project. Brainstorm outputs remain in the workspace; they are not automatically written into a storyboard or script, and the user copies them when needed.
_Avoid_: Storyboard Project, automatic write-back

**Brainstorm Conversation**:
An ideation thread within one Brainstorm Workspace. It owns a navigable Message graph and identifies the Message currently selected for continuation.
_Avoid_: Active project, chat snapshot

**Brainstorm Message**:
A stable node in a Brainstorm Conversation. A User Message records the user contribution; an Assistant Message records one ordered response while retaining its identity across lifecycle changes.
_Avoid_: Stream chunk, transcript row

**Brainstorm Turn**:
One user intent that establishes the next Assistant response in a Brainstorm Conversation. Appending, regenerating, and continuing are distinct Turn modes with different branching semantics.
_Avoid_: Model request, message batch

**Regenerated Response**:
A new Assistant Message that answers the same User Message as an earlier Assistant Message while preserving the earlier response as a sibling branch.
_Avoid_: Retry in place, overwrite

**Continued Response**:
The same terminal Assistant Message reopened to extend its ordered output without creating a sibling response.
_Avoid_: Regeneration, new branch

**Brainstorm Memory**:
A confirmed, durable fact or constraint belonging to a Brainstorm Workspace. It is independent from Storyboard, Scene, and Shot data; unconfirmed memory candidates are not Brainstorm Memory.
_Avoid_: Project Memory, Summary, prompt context, candidate memory

## Compatibility

**Compatibility Acceptance**:
Transparent acceptance of a provider-shaped generation request before its asynchronous task joins the shared lifecycle.
_Avoid_: First-party generation, Intent conversion

**Legacy Drain**:
The bounded period in which asynchronous compatibility tasks created before lifecycle cutover remain exclusively owned by the legacy observer until terminal or retention expiry.
_Avoid_: Dual polling, permanent fallback
