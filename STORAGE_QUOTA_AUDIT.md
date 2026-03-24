# STORAGE / QUOTA FINDINGS

**Date**: March 24, 2026
**Scope**: Per-user storage accounting across uploads, recordings, exports, deletes, soft deletes, reconciliation, concurrency, and quota enforcement
**Type**: Audit only — no code changes

---

## A. EXECUTIVE ASSESSMENT

Storage accounting in the StreamLine platform is **not production-safe in its current state**. The `usage.storageUsedBytes` counter on the user document is a monotonically increasing value: it is incremented on upload and export but **never decremented on any delete path**. Every delete operation (soft or hard) in `editing.ts`, `myContent.ts`, `recordings.ts`, `projects.ts`, and `maintenance.ts` removes R2 objects and Firestore documents but leaves the usage counter untouched. The counter itself uses a **read-then-write** pattern (`get → compute → update`) rather than Firestore's atomic `FieldValue.increment()`, creating a concurrency race window during simultaneous uploads. Storage usage tracking failures after successful R2 uploads are caught and swallowed as "non-critical," meaning files can be permanently stored without ever being counted. There is **no reconciliation mechanism** — no admin endpoint, script, cron, or worker to recompute `storageUsedBytes` from ground truth. The `/api/usage/summary` endpoint does not return storage data at all, and the client-side billing page hardcodes `storage.used: 0`. Taken together, these defects mean quota can only grow, users permanently lose quota after deleting files, concurrent uploads can bypass limits, and there is no way to detect or correct drift.

---

## B. CONFIRMED DEFECTS

### B1. No Storage Reclaim on Any Delete Path

- **Severity**: CRITICAL
- **Files/Functions**:
  - `streamline-server/routes/myContent.ts` — `DELETE /:id` (lines 90–119)
  - `streamline-server/routes/editing.ts` — `DELETE /assets/:id` (lines 489–549)
  - `streamline-server/routes/editing.ts` — `DELETE /projects/:id` (lines 781–814)
  - `streamline-server/routes/recordings.ts` — `DELETE /:id` (lines 1789–1868)
  - `streamline-server/routes/maintenance.ts` — `expireEmergencyRecordings` (lines 64–129)
  - `streamline-server/routes/maintenance.ts` — `purgeExpiredRecordings` (lines 220–260)
  - `streamline-server/routes/maintenance.ts` — `purgeDeletedAccounts` (lines 140–218)
- **What happens**: Every delete path performs R2 object deletion (via `deleteFile`, `deleteFiles`, `deletePrefix`, or `deleteRecordingStorage`) and Firestore document deletion/soft-delete, but **none** call `updateStorageUsage` with a negative value or decrement `usage.storageUsedBytes` in any way.
- **Why it matters**: Users permanently lose quota capacity after deleting files. Over time, `storageUsedBytes` can only increase, and users will eventually hit their plan's storage cap even if they have deleted all their content. This makes deleting files pointless from a quota perspective.
- **Effect**: **Stranded quota / permanent overcount**

#### Traced delete flows:

1. **`DELETE /api/my-content/:id`** (myContent.ts:90–119):
   `user request → get saved_videos doc → verify ownership → deleteFile(storagePath) [best-effort, warn on fail] → ref.delete() → return { ok: true }`
   **Missing**: No `updateStorageUsage(userId, -sizeBytes)`. The `sizeBytes` field is available on the document (`data.sizeBytes`) but is never read for quota release.

2. **`DELETE /api/editing/assets/:id`** (editing.ts:489–549):
   - Recording-backed path: `get recordings doc → verify ownership → deleteRecordingStorage(data) → recordings.doc.delete() → return`
   - Upload-backed path: `get editing_assets doc → verify ownership → deleteFile(storagePath) [warn on fail] → editing_assets.doc.delete() → return`
   **Missing**: No storage decrement on either path. `data.fileSize` is present on editing_assets docs (set at upload, line 287) but never used for quota release.

3. **`DELETE /api/recordings/:id`** (recordings.ts:1789–1868):
   `get recordings doc → verify ownership → deleteRecordingStorage(data) → clear room pointer [best-effort] → clear emergency pointer [best-effort] → hard delete doc OR soft-delete (status="deleted") → return`
   **Missing**: No storage decrement. `data.fileSize` exists on the recording doc (set by webhook or head-check) but is never used for quota release.

4. **`DELETE /api/editing/projects/:id`** (editing.ts:781–814):
   `get editing_projects doc → verify ownership → ref.delete() → return`
   **Note**: This deletes only the project metadata doc, not the associated assets or timeline clips. Individual asset files and their storage are not cleaned up — they become orphans.

5. **Maintenance: `expireEmergencyRecordings`** (maintenance.ts:64–129):
   `query expired emergencyRecording docs → deleteFiles/deletePrefix → set status="deleted" → mark recording doc deleted → annotate user doc`
   **Missing**: No storage decrement. R2 objects are deleted but `storageUsedBytes` is not adjusted.

6. **Maintenance: `purgeExpiredRecordings`** (maintenance.ts:220–260):
   `query recordings with deleteAfterMs <= now → deleteRecordingStorage(data) → set status="deleted"`
   **Missing**: No storage decrement.

7. **Maintenance: `purgeDeletedAccounts`** (maintenance.ts:140–218):
   `query users with deleteAfterMs <= now → delete subcollections → delete accounts doc → delete billingAudit docs → delete user doc`
   **Missing**: No deletion of user's R2 objects (recordings, uploads, exports). No decrement needed since user is deleted, but **R2 objects are orphaned permanently**.

---

### B2. Race Condition in Storage Check and Update (Read-Then-Write)

- **Severity**: HIGH
- **Files/Functions**:
  - `streamline-server/usageHelper.ts` — `checkStorageLimit` (lines 164–226)
  - `streamline-server/usageHelper.ts` — `updateStorageUsage` (lines 231–254)
- **What happens**: Both `checkStorageLimit` and `updateStorageUsage` follow a **read-then-write** pattern:
  1. `checkStorageLimit`: reads `usage.storageUsedBytes` → computes `newStorageGB` → compares against limit → throws if exceeded.
  2. `updateStorageUsage`: reads `usage.storageUsedBytes` → computes `currentStorageBytes + fileSizeBytes` → writes result.

  Neither uses `FieldValue.increment()` or Firestore transactions. There is a time window between read and write where another concurrent upload can read the same `storageUsedBytes` value.

- **Why it matters**: Two concurrent uploads for the same user can both pass the storage limit check with the stale value, and then both write their incremented value — but the second write overwrites the first, losing one increment. This results in:
  1. Both uploads succeeding even if only one should (quota bypass).
  2. The final `storageUsedBytes` reflecting only the last write, not the sum (undercount).

- **Risk scenario**: User has 4.9 GB used out of 5 GB limit. Two 200 MB uploads arrive simultaneously. Both read 4.9 GB, both pass the check (4.9 + 0.2 = 5.1 GB > 5.0 GB — actually both would fail in this case, but with smaller files, e.g., two 50 MB uploads at 4.95 GB, both read 4.95, both compute 5.0 GB, both pass). Both write `4.95 + 0.05 = 5.0 GB`. Final value: 5.0 GB instead of 5.05 GB. User has 100 MB of files stored but only 50 MB counted.

- **Contrast**: The PRE_LAUNCH_AUDIT.md (Section 3) claims usage tracking uses `FieldValue.increment()` and Firestore transactions. This is true for **streaming minutes** (in `usageOveragesWriter.ts`, `webhook.ts`, `hls.ts`) but **NOT true for storage bytes**. The storage counter in `usageHelper.ts` uses plain read-then-write.

- **Effect**: **Undercount / quota bypass on concurrent uploads**

---

### B3. Storage Tracking Treated as Best-Effort (Swallowed Failures)

- **Severity**: HIGH
- **Files/Functions**:
  - `streamline-server/routes/myContent.ts` — `POST /upload` (lines 269–274)
  - `streamline-server/routes/editing.ts` — `POST /assets/upload` (lines 275–280)
  - `streamline-server/routes/editing.ts` — export/render path (lines 1405–1410)
- **What happens**: After a successful R2 upload, `updateStorageUsage` is called inside a try/catch that swallows the error:
  ```
  // Update storage usage (best-effort)
  try {
    await updateStorageUsage(userId, file.size);
  } catch {
    console.warn("[my-content] storage usage update failed (non-critical)");
  }
  ```
  The upload response is returned as successful regardless of whether the usage counter was updated.

- **Why it matters**: If the Firestore write in `updateStorageUsage` fails (transient network error, quota, timeout), the file is permanently stored in R2, the Firestore metadata doc exists, but `storageUsedBytes` is never incremented. The user gets **free storage** for that upload. Over time, repeated failures create silent drift between actual storage consumption and the tracked counter.

- **Affected paths** (confirmed call sites):
  1. `myContent.ts:271` — device upload to My Content
  2. `editing.ts:277` — device upload to editing assets
  3. `editing.ts:1407` — export/render buffer upload

- **Note**: `checkStorageLimit` (pre-upload) is **not** best-effort — it throws and blocks the upload on failure. But `updateStorageUsage` (post-upload) failure is silently ignored, creating an asymmetry where the gate works but the counter doesn't, causing undercount.

- **Effect**: **Silent undercount / free storage / drift**

---

### B4. No Reconciliation Mechanism

- **Severity**: HIGH
- **Files/Functions**: Entire codebase — searched for `reconcil*` (prefix match for reconcile/reconciliation), `recalculate.*storage`, `recompute.*storage`
- **What happens**: There is **no** admin endpoint, background script, cron job, or worker that recalculates `usage.storageUsedBytes` from ground truth (actual R2 objects, Firestore collections `editing_assets`, `saved_videos`, `recordings`).
- **Existing reconciliation endpoints**:
  - `POST /api/rooms/:roomId/recordings/reconcile` — reconciles recording **status** (not storage bytes). It verifies R2 file existence and updates the recording doc's `status` and `fileSize`, but does not touch `usage.storageUsedBytes`.
  - `POST /api/billing/reconcile` — reconciles Stripe subscription state, not storage.
- **Why it matters**: Given defects B1 (no reclaim on delete), B2 (race conditions), and B3 (swallowed failures), `storageUsedBytes` will inevitably drift from reality. Without a reconciliation path, there is no way to detect or correct this drift. Operators have no mechanism to fix a user who reports "I deleted all my files but I'm still at 100% storage."
- **Effect**: **Operational risk — no recovery path for drifted counters**

---

### B5. Recording/Egress Webhook Does Not Track Storage

- **Severity**: MEDIUM
- **Files/Functions**:
  - `streamline-server/routes/webhook.ts` — egress_ended handler (lines 1200–1360)
  - `streamline-server/routes/recordings.ts` — post-stop head-check (lines 1628–1666)
  - `streamline-server/routes/myContent.ts` — `createSavedVideoFromRecording` (lines 313–356)
- **What happens**: When a LiveKit egress completes and writes a recording to R2:
  1. The webhook handler verifies the file via `r2HeadObjectSize`, obtains `fileSize`, and updates the recording doc.
  2. It calls `createSavedVideoFromRecording` which creates a `saved_videos` entry with `sizeBytes`.
  3. **Neither the webhook nor `createSavedVideoFromRecording` calls `updateStorageUsage`**.

  Similarly, the post-stop head-check in `recordings.ts` (line 1628–1666, triggered via `setTimeout` 4 seconds after stop) obtains the file size and updates the recording doc and calls `createSavedVideoFromRecording`, but never increments `storageUsedBytes`.

- **Why it matters**: Recording-produced files are stored in R2 but are **never counted** against the user's storage quota. Only direct device uploads (via `POST /my-content/upload` and `POST /editing/assets/upload`) and editor exports increment storage. This means all recordings — whether from LiveKit egress, stream-stop, emergency recordings, or any egress path — are **free from a quota perspective**.

- **Effect**: **Systematic undercount — recordings consume storage but are never tracked**

---

### B6. Soft Delete Strands Quota (Recordings)

- **Severity**: MEDIUM
- **Files/Functions**:
  - `streamline-server/routes/recordings.ts` — `DELETE /:id` soft-delete path (lines 1850–1861)
  - `streamline-server/routes/maintenance.ts` — `expireEmergencyRecordings` (line 98–103)
  - `streamline-server/routes/maintenance.ts` — `purgeExpiredRecordings` (line 249–252)
- **What happens**: The default recording delete is a **soft delete**: R2 objects are removed immediately (via `deleteRecordingStorage`), but the Firestore recording doc is kept with `status: "deleted"`. This creates a situation where:
  1. R2 bytes are freed.
  2. Firestore doc persists (for audit/recovery).
  3. `storageUsedBytes` is **not decremented** (per defect B1).

  Even if storage decrement were implemented, the question of **when** to decrement is ambiguous: at soft-delete time (when R2 is freed) or at hard-delete time (when the doc is removed)? Currently neither happens.

- **Additional soft-delete flows found**:
  - Emergency recording expiration (`maintenance.ts:98`): marks pointer `status: "deleted"`, marks recording doc `status: "deleted"`.
  - Expired recording purge (`maintenance.ts:249`): marks recording `status: "deleted"`, `deleteReason: "expired_retention"`.
  - Replaced emergency recording (`recordings.ts:1134`): sets old emergency recording to `status: "deleted"`.

- **Effect**: **Stranded quota — R2 bytes freed but counter never decremented**

---

### B7. `/api/usage/summary` Does Not Return Storage Data

- **Severity**: MEDIUM
- **Files/Functions**:
  - `streamline-server/routes/usageRoutes.ts` — `computeUsageSummaryResult` (lines 30–328)
  - `streamline-client/src/creator/pages/SettingsBilling.tsx` (lines 890–892)
  - `streamline-client/src/creator/pages/Join.tsx` (lines 395–396)
- **What happens**: The usage summary endpoint (`GET /api/usage/summary`) returns detailed minute-based usage (participant, transcode, HLS, recording) but **does not return `storageUsedBytes` or `maxStorageGB`** anywhere in its response payload. The response has no `storage` field.

  The client compensates:
  - `SettingsBilling.tsx:891`: Hardcodes `storage.used: 0` and infers `storage.limit` from `limits.storageGB` (which is not in the usage response — it comes from the plan endpoint or is hardcoded by plan name).
  - `Join.tsx:395–396`: Tries to read `um?.storageGB ?? um?.usage?.storageGB ?? 0`, which resolves to `0` because the usage response has no such field.

  The editing plan-info endpoint (`GET /api/editing/plan-info`) returns `maxStorageGB` but **not** `currentStorageUsed` or `storageUsedBytes`. So the client can show the limit but not the current usage.

- **Why it matters**: The UI **always shows storage usage as 0**, regardless of actual consumption. Users have no visibility into how much storage they've used. The storage progress bar is always empty.

- **Effect**: **Stale/incomplete UI — users see 0 storage used regardless of reality**

---

### B8. Project Delete Does Not Clean Up Assets or R2 Objects

- **Severity**: MEDIUM
- **Files/Functions**:
  - `streamline-server/routes/editing.ts` — `DELETE /projects/:id` (lines 781–814)
  - `streamline-server/routes/projects.ts` — `DELETE /:id` (line 229–243) delegates to `deleteProject`
- **What happens**: Deleting a project removes only the `editing_projects` Firestore document. It does **not**:
  1. Delete associated `editing_project_assets` docs.
  2. Delete associated `timeline_clips` docs.
  3. Delete R2 objects referenced by those assets.
  4. Decrement storage for any freed assets.

  Note: `DELETE /api/projects/:projectId/assets/:assetId` (projects.ts:364–401) detaches an asset from a project (deletes the `editing_project_assets` doc and associated timeline clips) but does **not** delete the underlying saved_video or editing_asset, and does **not** delete R2 objects or adjust storage.

- **Why it matters**: Project deletion orphans project assets and timeline clips in Firestore. R2 objects referenced by those assets persist indefinitely. If the underlying saved_video or recording is also deleted later, the orphaned project asset docs remain.

- **Effect**: **Orphaned metadata in Firestore; R2 objects not cleaned up on project delete**

---

### B9. Purge Deleted Accounts Does Not Clean R2 Objects

- **Severity**: LOW-MEDIUM
- **Files/Functions**:
  - `streamline-server/routes/maintenance.ts` — `purgeDeletedAccounts` (lines 140–218)
- **What happens**: When a soft-deleted user's `deleteAfterMs` TTL expires, the purge routine deletes Firestore subcollections (`rolePresets`, `emergencyRecording`), `accounts` doc, `billingAudit` docs, and the user doc. It does **not**:
  1. Query and delete the user's recordings from Firestore or R2.
  2. Query and delete the user's saved_videos from Firestore or R2.
  3. Query and delete the user's editing_assets from Firestore or R2.
  4. Delete any R2 prefixes for the user's content.
- **Why it matters**: After account purge, all of the user's R2 objects and content Firestore docs become permanently orphaned. No owner exists to delete them, and no routine cleans them up. This creates storage cost leakage on the R2 side.
- **Effect**: **Orphaned R2 objects after account deletion**

---

## C. COVERAGE MAP

### Upload Paths Checked

| Path | File | checkStorageLimit | updateStorageUsage | Counted? |
|------|------|:-----------------:|:------------------:|:--------:|
| `POST /api/my-content/upload` | myContent.ts:223–304 | ✅ Yes | ✅ Yes (best-effort) | ⚠️ Partial — swallowed on failure |
| `POST /api/editing/assets/upload` | editing.ts:215–310 | ✅ Yes | ✅ Yes (best-effort) | ⚠️ Partial — swallowed on failure |
| Editor export/render upload | editing.ts:1386–1420 | ✅ Yes | ✅ Yes (best-effort) | ⚠️ Partial — swallowed on failure |

### Recording Paths Checked

| Path | File | updateStorageUsage Called? | Counted? |
|------|------|:-------------------------:|:--------:|
| LiveKit egress_ended webhook | webhook.ts:1200–1360 | ❌ No | ❌ Not counted |
| Post-stop head-check (setTimeout) | recordings.ts:1628–1666 | ❌ No | ❌ Not counted |
| `POST /my-content/from-recordings` | myContent.ts:123–220 | ❌ No | ❌ Not counted |
| `createSavedVideoFromRecording` | myContent.ts:313–356 | ❌ No | ❌ Not counted |
| Emergency recording creation | recordings.ts:985–1140 | ❌ No | ❌ Not counted |

### Export/Render Paths Checked

| Path | File | updateStorageUsage Called? | Counted? |
|------|------|:-------------------------:|:--------:|
| Editor export with renderedBuffer | editing.ts:1386–1420 | ✅ Yes (best-effort) | ⚠️ Partial |
| Processing queue output | processingQueue.ts | ❌ No storage calls found | ❌ Not counted |
| Export queue output | exportQueue.ts | ❌ No storage calls found | ❌ Not counted |

### Delete Paths Checked

| Path | File | Decrements storageUsedBytes? |
|------|------|:----------------------------:|
| `DELETE /api/my-content/:id` | myContent.ts:90–119 | ❌ No |
| `DELETE /api/editing/assets/:id` (recording-backed) | editing.ts:503–518 | ❌ No |
| `DELETE /api/editing/assets/:id` (upload-backed) | editing.ts:521–544 | ❌ No |
| `DELETE /api/editing/projects/:id` | editing.ts:781–814 | ❌ No (doesn't even delete assets) |
| `DELETE /api/recordings/:id` (soft) | recordings.ts:1850–1861 | ❌ No |
| `DELETE /api/recordings/:id` (hard) | recordings.ts:1848–1849 | ❌ No |
| `DELETE /api/projects/:id` | projects.ts:229–243 | ❌ No |
| `DELETE /api/projects/:projectId/assets/:assetId` | projects.ts:364–401 | ❌ No |
| `DELETE /api/projects/:projectId/timeline/clips/:clipId` | projects.ts:646–688 | N/A (no storage) |
| `DELETE /api/editing/content-items/:id` | editing.ts:1800–1819 | N/A (reference only) |
| Maintenance: expire emergency recordings | maintenance.ts:64–129 | ❌ No |
| Maintenance: purge expired recordings | maintenance.ts:220–260 | ❌ No |
| Maintenance: purge deleted accounts | maintenance.ts:140–218 | ❌ No (doesn't even delete R2) |
| Maintenance: purge stale HLS | maintenance.ts:262–340 | N/A (HLS, not user storage) |

### Reconciliation Paths Checked

| Path | Reconciles storageUsedBytes? |
|------|:----------------------------:|
| `POST /api/rooms/:roomId/recordings/reconcile` | ❌ No — reconciles recording status only |
| `POST /api/billing/reconcile` | ❌ No — reconciles Stripe state only |
| Admin endpoints (`/api/admin/users`, `/api/admin/usage`) | ❌ Read-only, no recalculation |
| Cron/scripts | ❌ None found for storage |
| Manual admin tool | ❌ None found |

---

## D. RELEASE RISK

### Is storage accounting production-safe? **NO.**

The storage accounting system has fundamental structural defects that will cause progressive degradation over time:

1. **Users will permanently lose quota** — every delete strands quota because `storageUsedBytes` is never decremented. This will generate support tickets immediately after users try to free space.

2. **Users can exceed quota** — the read-then-write pattern in `checkStorageLimit`/`updateStorageUsage` allows concurrent uploads to bypass limits. This is a paying-customer trust issue.

3. **Recordings are free storage** — the most common media-producing path (LiveKit recordings) does not increment storage at all. Users are only charged for manual device uploads and editor exports, not for recordings that may be significantly larger.

4. **UI shows wrong data** — the billing page always shows 0 storage used. Users have no way to understand or manage their storage.

5. **No recovery path** — when (not if) drift occurs, there is no way to fix it without building a reconciliation tool.

### Minimum Issues That Must Be Resolved Before Release

| # | Issue | Defect | Priority |
|---|-------|--------|----------|
| 1 | Implement storage decrement on all delete paths | B1 | BLOCKER |
| 2 | Switch to `FieldValue.increment()` for storage counter | B2 | BLOCKER |
| 3 | Promote `updateStorageUsage` from best-effort to required (or compensate on failure) | B3 | HIGH |
| 4 | Add `updateStorageUsage` to recording/webhook ready path | B5 | HIGH |
| 5 | Return `storageUsedBytes` and `maxStorageBytes` from `/api/usage/summary` | B7 | HIGH |
| 6 | Build admin reconciliation endpoint | B4 | HIGH (can be post-launch with caution) |
| 7 | Clean up R2 objects on project delete or account purge | B8, B9 | MEDIUM (post-launch acceptable) |

---

## SPECIFIC QUESTIONS ANSWERED

### 1. Can a user permanently lose quota after deleting files?
**YES.** Confirmed. Every delete path (myContent, editing assets, recordings — soft and hard, maintenance cron) removes R2 objects and Firestore docs but never decrements `usage.storageUsedBytes`. The quota consumed by deleted files is permanently stranded.

### 2. Can a user exceed quota through concurrent uploads?
**YES.** Confirmed. `checkStorageLimit` uses read-then-compare (not transactional). Two uploads arriving within the read-write window will both see the same `storageUsedBytes` value and both pass the check. Additionally, `updateStorageUsage` uses read-then-write (not `FieldValue.increment`), so the second write overwrites the first, causing undercount.

### 3. Can a user get free storage if tracking fails?
**YES.** Confirmed. `updateStorageUsage` failures are caught and swallowed with `console.warn` in all three upload paths (myContent.ts:272, editing.ts:278, editing.ts:1408). The R2 upload and Firestore metadata write succeed regardless.

### 4. Can `storageUsedBytes` drift from actual R2/Firestore reality?
**YES.** Confirmed through multiple vectors:
- Deletes don't decrement (B1) → overcount
- Race conditions (B2) → undercount
- Swallowed failures (B3) → undercount
- Recordings never counted (B5) → undercount
- Net effect is unpredictable: overcount from stranded quota and undercount from missed tracking can co-exist.

### 5. Is there any current mechanism to reconcile drift?
**NO.** Confirmed. No admin endpoint, no script, no cron, no worker exists to recalculate `storageUsedBytes` from the actual contents of R2 or Firestore collections (`saved_videos`, `editing_assets`, `recordings`). The `recordings/reconcile` endpoint reconciles recording status, not storage bytes.

### 6. Are all recording and export paths accounted for?
**NO.** Confirmed gaps:
- LiveKit egress webhook (recording becomes ready) — **not tracked**
- Post-stop head-check (recording confirmed via setTimeout) — **not tracked**
- `createSavedVideoFromRecording` (auto-creates saved_video) — **not tracked**
- Emergency recording creation — **not tracked**
- Processing queue outputs — **no storage tracking calls found**
- Export queue outputs — **no storage tracking calls found**
- Only direct device uploads and editor export-with-buffer are tracked.

### 7. Are there any orphaned object or orphaned metadata risks?
**YES.** Confirmed:
- **Project deletion** (editing.ts, projects.ts): Deletes project doc but not associated editing_project_assets, timeline_clips, or R2 objects → orphaned metadata + R2 objects.
- **Account purge** (maintenance.ts): Deletes user doc and subcollections but not recordings, saved_videos, editing_assets, or R2 objects → orphaned everything.
- **Soft-delete recordings with missing hard-delete follow-up**: Firestore docs with status="deleted" persist indefinitely if no purge job targets them.

### 8. Is quota enforcement truly server-side and authoritative?
**PARTIALLY.** `checkStorageLimit` is called server-side before uploads and exports, which is correct. However:
- The check is not transactional (susceptible to TOCTOU races) — see B2.
- Recording-produced files bypass the check entirely — see B5.
- The check relies on a counter that drifts — see B1, B3, B4.
- The 500 MB per-file limit is enforced server-side via multer (correct).
- Plan limits are fetched from Firestore plans collection (correct).

---

**End of Storage / Quota Audit**
