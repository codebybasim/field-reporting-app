# FieldReport — React Native Field Reporting App

A production-quality, offline-first field reporting application built for the Wyxan React Native Technical Assessment.

Field inspectors compose reports with photos locally, and the app delivers them reliably to a Supabase backend — surviving network loss, force-quit, and device restart.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Technology Decisions](#3-technology-decisions)
4. [Prerequisites](#4-prerequisites)
5. [Installation](#5-installation)
6. [Running on Android](#6-running-on-android)
7. [Supabase Project Setup](#7-supabase-project-setup)
8. [SQL Migrations](#8-sql-migrations)
9. [Storage Bucket Configuration](#9-storage-bucket-configuration)
10. [Environment Variables](#10-environment-variables)
11. [Backend Deployment](#11-backend-deployment)
12. [Failure Simulation](#12-failure-simulation)
13. [Retry and Idempotency Design](#13-retry-and-idempotency-design)
14. [Image Compression Strategy](#14-image-compression-strategy)
15. [Reset Semantics](#15-reset-semantics)
16. [Automated Testing](#16-automated-testing)
17. [Manual Testing](#17-manual-testing)
18. [Known Limitations](#18-known-limitations)
19. [What Would Be Improved With Another Day](#19-what-would-be-improved-with-another-day)

---

## 1. Project Overview

FieldReport lets a field inspector:

- Compose a report with a description and 1–5 photographs
- Save the report locally when offline
- Automatically deliver it to the backend when connectivity is restored
- Review server-confirmed reports fetched directly from Supabase
- Reset local data without touching server-side records

**Primary goal: reliable delivery, not feature quantity.**

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     React Native App                        │
│                                                             │
│  Compose Screen ──► ReportComposerService                   │
│      │                  │                                   │
│      │          ImageProcessor (compress → 4.5 MB)         │
│      │          FileSystemService (app-private storage)     │
│      │          SQLite Repositories (reports/images/jobs)   │
│      │          BackgroundScheduler.scheduleUpload()        │
│      │                                                      │
│  Outbox Screen ◄── reportStore (Zustand, reads SQLite)      │
│                                                             │
│  Server Screen ──► ReportApiService.fetchServerReports()    │
│                         │ (direct Supabase query)           │
│                                                             │
│  AppBootProvider                                            │
│      ├── StartupReconciler (fix orphans/stuck states)       │
│      └── ConnectivityDispatcher (trigger on network up)     │
│                                                             │
│  BackgroundScheduler                                        │
│      ├── react-native-background-actions (foreground svc)   │
│      │       └── UploadCoordinator.processQueue()           │
│      └── WorkManager (backup, launches app if killed)       │
│                                                             │
└──────────────────────────────────────┬──────────────────────┘
                                       │ HTTPS
┌──────────────────────────────────────▼──────────────────────┐
│                      Supabase                               │
│                                                             │
│  Edge Functions                                             │
│    create-report   — idempotent report creation             │
│    register-image  — metadata registration + verification   │
│    finalize-report — image-count check + status update      │
│    failure-simulator — dev-only failure injection           │
│                                                             │
│  PostgreSQL                                                 │
│    reports         — idempotency_key UNIQUE                 │
│    report_images   — (report_id, client_image_id) UNIQUE    │
│                                                             │
│  Storage                                                    │
│    report-images   — private bucket, 5 MB ceiling           │
│    Path: reports/{reportId}/{imageId}.jpg                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Database | `@op-engineering/op-sqlite` | JSI synchronous API; fastest RN SQLite option; New Architecture support |
| Background upload | `react-native-background-actions` | Stable foreground service; no Headless JS crashes on RN 0.88 NA |
| WorkManager | Custom Kotlin module | Backup for killed-app recovery; schedules app launch via intent |
| Image compression | `@bam.tech/react-native-image-resizer` | Active fork; supports `content://` and `file://` URIs |
| State management | Zustand | Lightweight; upload logic stays outside React entirely |
| Backend | Supabase | Removes Express boilerplate; PostgreSQL + Storage + Edge Functions |
| Idempotency | Client UUID as idempotency key | Stable across retries; server upserts on conflict |

---

## 4. Prerequisites

- Node.js ≥ 22.11.0
- npm ≥ 11 or yarn ≥ 1.22
- Java / JDK 17 (Temurin recommended)
- Android SDK with:
  - Platform 37
  - Build Tools 36+
  - NDK 27.1.12297006
- A physical Android device or emulator (API 24+)
- A Supabase project (free tier is sufficient)

---

## 5. Installation

```bash
# Clone the repository
git clone https://github.com/codebybasim/field-reporting-app.git
cd field-reporting-app

# Install JavaScript dependencies
npm install

# Copy environment template and fill in your Supabase values
cp .env.example .env
# Edit .env and set SUPABASE_URL and SUPABASE_ANON_KEY
```

---

## 6. Running on Android

```bash
# Start Metro bundler (in a separate terminal)
npx react-native start

# Build and install the debug APK (in another terminal)
npx react-native run-android
```

Or build the APK manually:

```bash
cd android
./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 7. Supabase Project Setup

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Note your **Project URL** and **anon key** from Settings → API
3. Set them in your `.env` file (see [Environment Variables](#10-environment-variables))

---

## 8. SQL Migrations

Run both migration files in order using the Supabase SQL editor
(Database → SQL Editor → New query):

**Migration 1 — Schema:**
```
supabase/migrations/001_initial_schema.sql
```

Creates:
- `reports` table with `idempotency_key UNIQUE`
- `report_images` table with `(report_id, client_image_id) UNIQUE`
- Row-Level Security: anon can read finalized reports only
- `update_updated_at` trigger

**Migration 2 — Storage bucket:**
```
supabase/migrations/002_storage_bucket.sql
```

Creates:
- `report-images` private bucket
- 5 MB file size ceiling
- JPEG-only MIME type restriction
- Storage RLS policies

**Via Supabase CLI:**
```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

---

## 9. Storage Bucket Configuration

The migration handles bucket creation. Verify in your Supabase dashboard:

- **Bucket name:** `report-images`
- **Public:** No (private)
- **File size limit:** 5 242 880 bytes (5 MB)
- **Allowed MIME types:** `image/jpeg`

---

## 10. Environment Variables

Copy `.env.example` to `.env` and fill in:

```env
# Required — from Supabase project Settings → API
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here

# Optional — set to "true" in Supabase project secrets to enable failure simulator
ENABLE_FAILURE_SIMULATOR=false
```

**Never commit `.env`.** It is git-ignored. The `.env.example` file with placeholders is safe to commit.

To enable the failure simulator on Supabase Edge Functions:

```bash
supabase secrets set ENABLE_FAILURE_SIMULATOR=true
```

---

## 11. Backend Deployment

Deploy all four Edge Functions:

```bash
# Install Supabase CLI
npm install -g supabase

# Link to your project
supabase link --project-ref YOUR_PROJECT_REF

# Deploy all functions
supabase functions deploy create-report
supabase functions deploy register-image
supabase functions deploy finalize-report
supabase functions deploy failure-simulator

# Set secrets
supabase secrets set ENABLE_FAILURE_SIMULATOR=false
```

The `failure-simulator` function requires `ENABLE_FAILURE_SIMULATOR=true` in Supabase secrets to accept any requests. Leave it `false` in production.

---

## 12. Failure Simulation

### Activating from the app (recommended)

1. Open the **Server Reports** tab
2. Tap the list header **5 times quickly**
3. The dev simulator panel slides up
4. Select a failure mode

### Activating via curl

```bash
PROJECT_URL="https://your-project-ref.supabase.co"
ANON_KEY="your-anon-key"

# Set mode
curl -X POST "$PROJECT_URL/functions/v1/failure-simulator" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"mode": "drop"}'

# Get current mode
curl "$PROJECT_URL/functions/v1/failure-simulator" \
  -H "Authorization: Bearer $ANON_KEY"

# Disable
curl -X POST "$PROJECT_URL/functions/v1/failure-simulator" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"mode": "none"}'
```

### Modes

| Mode | Behaviour | Tests |
|---|---|---|
| `none` | Normal operation | — |
| `slow` | 3-second delay then real response | Timeout patience, slow network |
| `drop` | Commits operation, drops connection | Lost-response idempotency |
| `error` | HTTP 500, no work done | Retryable error path |
| `reject` | HTTP 400, no work done | Permanent failure, no retry |
| `hang` | 25-second delay then 504 | Gateway timeout handling |

### How to make it fail

**Scenario: server receives image but client never gets the response**

1. Set mode to `drop`
2. Save a report with photos
3. Enable Wi-Fi and observe the outbox
4. The upload attempt fails mid-flight
5. The coordinator retries
6. On retry, `register-image` uses `upsert` with `onConflict: report_id,client_image_id`
7. The existing registration is returned — no duplicate created
8. The report eventually finalizes

**Scenario: force-quit mid-upload**

1. Start an upload (watch outbox)
2. Force-quit the app
3. Re-open — StartupReconciler resets `uploading` → `pending`
4. BackgroundScheduler restarts and resumes

---

## 13. Retry and Idempotency Design

### Client-side retry

`RetryPolicy.ts` classifies every error:

- **Permanent** (no retry): HTTP 400, 401, 403, 404, 413, or any non-retryable 4xx
- **Retryable**: HTTP 408, 429 (with Retry-After), 5xx, network errors, timeouts

Backoff: exponential with **full jitter** — `delay = random(0, BASE × 2^attempt)`, capped at 5 minutes. Maximum 8 attempts before permanent failure.

### Server-side idempotency

Every operation uses a stable client-generated UUID as the idempotency key:

```
Report creation:  upsert on idempotency_key (UNIQUE constraint)
Image storage:    PUT with x-upsert:false — 409 means already uploaded, continue
Image register:   upsert on (report_id, client_image_id) (UNIQUE constraint)
Finalization:     safe to call multiple times — already_finalized: true returned
```

The `drop` failure mode proves this: the server commits, the client retries, the upsert returns the existing record without mutation.

### Generation-based invalidation

Each `upload_job` has a `generation` column. When Reset is called, the generation is incremented. Running workers check their stored generation against the current value before writing progress — stale workers self-invalidate without needing cancellation.

---

## 14. Image Compression Strategy

Raw camera photos can be 18 MB or larger. Every image is processed before being queued:

1. Pass source URI to `@bam.tech/react-native-image-resizer`
2. Maximum dimension: 2400 px (preserves aspect ratio, `onlyScaleDown: true`)
3. JPEG quality starts at 85 and steps down: 85 → 75 → 65 → 55 → 45 → 35 → 25
4. Each step checks the output file size via `result.size` (returned by the library)
5. Loop stops as soon as size ≤ 4.5 MB
6. If the image cannot be compressed below 5 MB at quality 25, the user is shown an error
7. SHA-256 checksum computed on the final output
8. File copied to app-private Document storage (`/data/data/com.feildreporting/files/reports/{reportId}/{imageId}.jpg`)
9. Temporary files in the system cache directory are deleted

**outputPath note:** The bam.tech library treats the `outputPath` argument as a directory, not a file path. We pass `null` and read the generated path from `result.path`.

---

## 15. Reset Semantics

The Reset action (Outbox → Reset button):

**Destroys locally:**
- All SQLite records (`reports`, `report_images`, `upload_jobs`)
- All image files in app-private storage
- Pending WorkManager jobs
- Active foreground upload service

**Preserves on server:**
- All Supabase `reports` and `report_images` records
- All files in Supabase Storage

**User sees:** A two-step confirmation dialog that explicitly states how many pending reports will be deleted and that server data is safe.

**Generation bump:** The `upload_jobs.generation` column is incremented so any in-flight workers self-invalidate.

---

## 16. Automated Testing

```bash
# Run all unit tests
npx jest --testPathPattern="tests/unit" --runInBand

# With coverage
npx jest --testPathPattern="tests/unit" --coverage
```

### Test coverage

**RetryPolicy** (17 tests):
- ✅ HTTP 400/413/404 → permanent
- ✅ HTTP 500/503/429/408 → retryable
- ✅ Network error messages → retryable
- ✅ Unknown errors → retryable
- ✅ Retry-After header respected
- ✅ Later attempts produce longer delays
- ✅ Max attempts returns null

**UploadCoordinator** (15 tests):
- ✅ Single-image report end-to-end
- ✅ Five-image report (all images uploaded)
- ✅ Already-uploaded images skipped on retry
- ✅ Idempotent retry after lost response
- ✅ Storage 409 → continues to register
- ✅ HTTP 400 → permanent failure
- ✅ HTTP 413 → permanent failure
- ✅ HTTP 500 → retry scheduled
- ✅ Network failure → retry scheduled
- ✅ Max attempts → permanent failure
- ✅ Concurrent processQueue → second call is no-op
- ✅ Reset clears running state
- ✅ Stale generation jobs skipped
- ✅ Multiple reports processed sequentially
- ✅ Future nextAttemptAt respected

---

## 17. Manual Testing

### Verified scenarios

| Scenario | Status |
|---|---|
| Save report in airplane mode | ✅ Tested |
| Report survives app backgrounding | ✅ Tested |
| Network restore triggers upload | ✅ Tested |
| Image compression < 5 MB | ✅ Tested |
| Server Reports screen shows delivered reports | ✅ Tested |
| Reset deletes local, preserves server | ✅ Tested |

### Unverified scenarios (require manual testing)

| Scenario | Status |
|---|---|
| Force-quit mid-upload, reopen | ⬜ Not verified |
| Device restart with pending reports | ⬜ Not verified |
| Throttled network (Network Link Conditioner) | ⬜ Not verified |
| Largest camera images (18 MB+) on physical device | ⬜ Not verified |
| Camera/gallery permission denial and restoration | ⬜ Not verified |
| Repeated connection loss during multi-report upload | ⬜ Not verified |
| WorkManager wakeup after process death | ⬜ Not verified |
| `drop` mode idempotency proof end-to-end | ⬜ Not verified |

### Manual test procedure: offline delivery

1. Enable Airplane Mode on device
2. Open app → Compose tab
3. Write a description, add 3 photos, tap Save
4. Verify Outbox shows "Waiting" status
5. Force-quit the app
6. Re-open — report should still show "Waiting" (StartupReconciler preserved it)
7. Disable Airplane Mode
8. Wait — ConnectivityDispatcher triggers upload within seconds
9. Outbox transitions: Waiting → Uploading → Delivered ✓
10. Switch to Server Reports tab → verify report appears with server ID

---

## 18. Known Limitations

**WorkManager after force-stop:**
Android blocks WorkManager execution after the user force-stops an app via Settings. The app must be relaunched manually. This is an OS restriction and cannot be worked around. Once the user reopens the app, `AppBootProvider` triggers the upload via `triggerIfConnected()`.

**Headless JS on New Architecture:**
`HeadlessJsTaskContext` crashes on RN 0.88 with New Architecture enabled. We use `react-native-background-actions` (a foreground service) instead. This means uploads only run while the app is alive (foreground or background), not after force-stop.

**15-minute WorkManager minimum:**
WorkManager periodic work has a minimum interval of 15 minutes. We use one-time work re-enqueued on connectivity change, which gives much faster response in practice.

**iOS:**
This app is Android-only. The upload scheduling, WorkManager, and background service code are all Android-specific. iOS support would require a different background execution strategy.

**SQLite in Headless context:**
`@op-engineering/op-sqlite` uses JSI which requires a running JS engine. This is why the WorkManager path launches the app rather than running SQLite queries from a pure native background thread.

---

## 19. What Would Be Improved With Another Day

1. **True background upload after force-kill:** Implement a pure-Kotlin upload worker using OkHttp that reads SQLite via the Android room library directly — no JS bridge needed. This would upload even after force-stop.

2. **Periodic WorkManager retry:** Schedule a 15-minute periodic task as a guaranteed delivery backstop for uploads that keep failing.

3. **Upload progress per image:** Show bytes transferred / total bytes for each image in the Outbox card.

4. **Notification on delivery:** Post a local notification when all reports are successfully delivered.

5. **Integration tests:** Test the full flow against a real Supabase instance using a test project with seeded data.

6. **iOS support:** Implement `BGTaskScheduler` / `BGProcessingTask` equivalent for the delivery path.

7. **Retry-After from Supabase headers:** Extract the actual `Retry-After` response header value rather than parsing it from the error message string.

8. **Image preview caching:** Cache signed URLs for server report images so they don't expire between refreshes.
