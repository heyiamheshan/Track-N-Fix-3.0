# TrackNFix 3.0 — Complete System Documentation

**Workshop:** Jayakody Auto Electrical  
**Version:** 3.0  
**Stack:** Node.js/Express + Next.js 16 + PostgreSQL + Prisma ORM  

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Database Schema](#3-database-schema)
4. [User Roles & Authentication](#4-user-roles--authentication)
5. [Backend API Reference](#5-backend-api-reference)
   - [Auth](#51-auth-routes--apiauthh)
   - [Jobs](#52-job-routes--apijobs)
   - [Quotations](#53-quotation-routes--apiquotations)
   - [Vehicles](#54-vehicle-routes--apivehicles)
   - [Images](#55-image-routes--apiimages)
   - [Employees](#56-employee-routes--apiemployees)
   - [Attendance](#57-attendance-routes--apiattendance)
   - [Inventory](#58-inventory-routes--apiinventory)
   - [Analytics](#59-analytics-routes--apianalytics)
   - [Notifications](#510-notification-routes--apinotifications)
   - [Search](#511-search-routes--apisearch)
   - [Voice / AI Assistant](#512-voice--ai-assistant-routes--apivoice)
6. [Scheduled Jobs (Cron)](#6-scheduled-jobs-cron)
7. [Frontend Dashboards](#7-frontend-dashboards)
   - [Employee Dashboard](#71-employee-dashboard)
   - [Admin Dashboard](#72-admin-dashboard)
   - [Manager Dashboard](#73-manager-dashboard)
8. [AI Voice Assistant](#8-ai-voice-assistant)
9. [Core Business Flows](#9-core-business-flows)
10. [Notifications System](#10-notifications-system)
11. [File Upload System](#11-file-upload-system)
12. [Environment Configuration](#12-environment-configuration)
13. [Project File Structure](#13-project-file-structure)
14. [Full System Workflow](#14-full-system-workflow)
15. [Testing](#15-testing)

---

## 1. System Overview

TrackNFix 3.0 is a full-stack vehicle service management system built for Jayakody Auto Electrical. It digitises the entire workshop workflow — from job creation on the workshop floor, through quotation management and inventory tracking, to customer delivery and financial reporting.

### Key Capabilities

| Capability | Description |
|---|---|
| Job Tracking | Multi-step job lifecycle from intake to completion |
| Quotation Management | Admin creates, manager finalises with automatic inventory deduction |
| Inventory Control | Spare parts with stock ledger, low-stock alerts |
| Attendance System | Check-in/out, leave, overtime, holidays — all approval-based |
| Financial Analytics | Revenue, COGS, gross profit, per-category breakdown |
| Vehicle History | Full service timeline per vehicle registration |
| AI Voice Assistant | Natural language queries via Groq Whisper + LLaMA-3 |
| Customer Delivery | WhatsApp integration for customer notifications |

---

## 2. Architecture

```
┌─────────────────────────────────────────────┐
│              CLIENT BROWSER                 │
│  Next.js 16 App Router (localhost:3000)     │
│  React 19 · Tailwind CSS v4 · Axios         │
└──────────────┬──────────────────────────────┘
               │ HTTP/REST (JWT Bearer)
               ▼
┌─────────────────────────────────────────────┐
│           EXPRESS BACKEND (localhost:5001)  │
│  TypeScript · Prisma ORM · Multer · Cron   │
└──────────────┬──────────────────────────────┘
               │
       ┌───────┴───────┐
       ▼               ▼
┌────────────┐  ┌──────────────────────┐
│ PostgreSQL │  │   Groq Cloud API     │
│ port 5433  │  │  Whisper + LLaMA-3   │
└────────────┘  └──────────────────────┘
```

**Authentication:** JWT tokens (7-day expiry) stored in `localStorage` as `tnf_token`. Every API request sends `Authorization: Bearer <token>`.

---

## 3. Database Schema

Provider: **PostgreSQL** via Prisma ORM. All primary keys are UUIDs (`@default(uuid())`). Timestamps use `@default(now())` for `createdAt` and `@updatedAt` for `updatedAt`.

---

### Models

#### User
Central user model shared by all three roles. Every functional actor in the system — employee, admin, or manager — is a row in this table.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | String | PK, UUID | Primary key |
| name | String | | Display name |
| email | String | Unique | Login credential |
| password | String | | bcrypt hashed |
| role | Role | Enum | EMPLOYEE / ADMIN / MANAGER |
| address | String? | | Optional home address |
| isActive | Boolean | Default true | false = login blocked |
| isFirstLogin | Boolean | Default true | Redirects to password-change on first login |
| nicNumber | String? | Unique | National ID number |
| otpCode | String? | | Current password-reset OTP |
| otpExpiry | DateTime? | | OTP expiry timestamp (10 min window) |
| createdAt | DateTime | Default now() | |
| updatedAt | DateTime | @updatedAt | |

**Relations:** `jobs[]`, `attendanceRecords[]`, `attendanceRequests[]`, `adminReviews[]`, `leaves[]`, `adminLeaves[]`, `overtimes[]`, `adminOvertime[]`, `holidays[]`, `adminHolidays[]`, `notifications[]`, `adminQuotations[]`, `managerQuotations[]`, `attendanceHistory[]`

---

#### Vehicle
Created automatically when a new vehicle registration is first seen on a job. Serves as the anchor for the full service history.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | String | PK, UUID | |
| vehicleNumber | String | Unique | Registration plate, e.g. WP-ABC-1234 |
| ownerName | String? | | |
| address | String? | | Owner's address |
| telephone | String? | | Primary contact number |
| vehicleType | String? | | e.g. Car, Van, Truck |
| color | String? | | |
| whatsappNumber | String? | | Used to pre-fill WhatsApp delivery message |
| createdAt | DateTime | Default now() | |
| updatedAt | DateTime | @updatedAt | |

**Relations:** `jobs[]`, `quotations[]`

---

#### Job
The core work order. One job per vehicle visit. Lifecycle managed via `JobStatus`.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | String | PK, UUID | |
| jobNumber | Int | Unique, autoincrement | Human-readable job number |
| vehicleId | String | FK → Vehicle | |
| employeeId | String | FK → User | The employee who created it |
| jobType | JobType | Enum | SERVICE / REPAIR / ACCIDENT_RECOVERY |
| status | JobStatus | Enum, Default DRAFT | Full lifecycle enum (see below) |
| notes | String? | | Free-text job description |
| insuranceCompany | String? | | Required for ACCIDENT_RECOVERY |
| voiceNoteUrl | String? | | Path to uploaded audio file |
| createdAt | DateTime | Default now() | |
| updatedAt | DateTime | @updatedAt | |

**Relations:** `employee` (User), `vehicle` (Vehicle), `images[]` (JobImage), `quotations[]` (Quotation)

---

#### JobImage
Before/after/part photographs attached to a job. Cascade-deleted when the parent job is deleted.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | String | PK, UUID | |
| jobId | String | FK → Job, onDelete Cascade | |
| phase | ImagePhase | Enum | BEFORE / AFTER / PART |
| url | String | | File path served from `/uploads/` |
| caption | String? | | |
| createdAt | DateTime | Default now() | |

---

#### Quotation
Financial document created by Admin against a reviewed job, then sent to and finalised by Manager.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | String | PK, UUID | |
| jobId | String | FK → Job | |
| vehicleId | String | FK → Vehicle | |
| adminId | String | FK → User | Admin who created the quotation |
| managerId | String? | FK → User | Manager who finalised (null until finalised) |
| vehicleNumber | String | | Denormalised for fast display |
| ownerName | String? | | Customer name (copied from vehicle or overridden) |
| address | String? | | |
| telephone | String? | | Must be present before sending to manager |
| vehicleType | String? | | |
| color | String? | | |
| insuranceCompany | String? | | |
| jobDetails | String? | | Summary of work |
| totalAmount | Float? | | Calculated and set on finalisation |
| pdfUrl | String? | | Reserved for PDF storage |
| status | QuotationStatus | Enum, Default DRAFT | See status flow below |
| notificationSent | Boolean | Default false | True after customer is marked as notified |
| notifiedAt | DateTime? | | Timestamp of customer notification |
| whatsappNumber | String? | | Pre-fills WhatsApp delivery message |
| createdAt | DateTime | Default now() | |
| updatedAt | DateTime | @updatedAt | |

**Relations:** `items[]` (QuotationItem, cascade delete), `admin` (User), `manager` (User?), `job` (Job), `vehicle` (Vehicle)

---

#### QuotationItem
Individual line items within a quotation. Cascade-deleted with the parent quotation.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | String | PK, UUID | |
| quotationId | String | FK → Quotation, onDelete Cascade | |
| description | String | | Work description |
| partReplaced | String? | | Name or serial of replaced part |
| price | Float | Default 0 | Parts/material cost |
| laborCost | Float | Default 0 | Labour cost |
| quantity | Int | Default 1 | Number of units |
| sparePartId | String? | FK → SparePart | Links to inventory; triggers stock deduction on finalise |

---

#### SparePart
Inventory item. Stock level is authoritative here; the StockLedger records every change.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | String | PK, UUID | |
| name | String | | Part name |
| serialNumber | String | Unique | Part serial / catalogue number |
| description | String? | | |
| boughtPrice | Float | | Cost price (used for COGS calculation) |
| sellingPrice | Float | | Sale price |
| quantity | Int | Default 0 | Current stock level |
| lowStockThreshold | Int | Default 5 | Badge shown when quantity ≤ threshold |
| supplierName | String? | | |
| supplierDetails | String? | | |
| purchaseDate | DateTime? | | |
| createdAt | DateTime | Default now() | |
| updatedAt | DateTime | @updatedAt | |

**Relations:** `quotationItems[]` (QuotationItem), `stockLedger[]` (StockLedger)

---

#### StockLedger
Immutable append-only audit log. One row per stock change event. Never updated or deleted.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | String | PK, UUID | |
| sparePartId | String | FK → SparePart | |
| change | Int | | Positive = stock added, Negative = stock consumed |
| reason | String? | | Human-readable description of the change |
| quotationId | String? | | Set when change originates from a finalised quotation |
| jobNumber | Int? | | Linked job number for traceability |
| createdAt | DateTime | Default now() | |

---

#### Attendance
One record per employee per working day. The `@@unique([employeeId, date])` constraint enforces a single record per day.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | String | PK, UUID | |
| employeeId | String | FK → User | |
| date | DateTime | @db.Date | Date portion only (no time) |
| checkInTime | DateTime? | | Actual check-in timestamp (set when admin approves CHECKIN) |
| checkOutTime | DateTime? | | Actual check-out timestamp |
| status | AttendanceStatus | Enum, Default PRESENT | Current day status |
| overtimeStart | DateTime? | | Set when overtime begins |
| overtimeEnd | DateTime? | | Set when overtime ends |
| notes | String? | | Admin notes |
| createdAt | DateTime | Default now() | |

**Unique constraint:** `[employeeId, date]`

---

#### AttendanceRequest
Pending approval queue. Every attendance action (check-in, check-out, overtime, leave end, holiday) creates a request that the admin must approve or reject.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | String | PK, UUID | |
| employeeId | String | FK → User | Employee who made the request |
| adminId | String? | FK → User | Admin who reviewed it (null until reviewed) |
| type | AttendanceRequestType | Enum | The action being requested |
| requestedTime | DateTime | | When the employee says the action occurred |
| reason | String? | | Required for EARLY_CHECKOUT |
| status | RequestStatus | Enum, Default PENDING | PENDING / APPROVED / REJECTED |
| reviewedAt | DateTime? | | Timestamp of admin decision |
| createdAt | DateTime | Default now() | |

---

#### Leave
A leave application covering a date range.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | String | PK, UUID | |
| employeeId | String | FK → User | |
| adminId | String? | FK → User | Admin who approved/rejected |
| leaveFrom | DateTime | | Start of leave period |
| leaveTo | DateTime | | End of leave period |
| reason | String? | | |
| status | LeaveStatus | Enum, Default PENDING | PENDING / APPROVED / REJECTED |
| leaveEndConfirmed | Boolean | Default false | Employee must confirm return after leave ends |
| createdAt | DateTime | Default now() | |

---

#### Overtime
An overtime session linked to an employee.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | String | PK, UUID | |
| employeeId | String | FK → User | |
| adminId | String? | FK → User | Admin who approved |
| overtimeStart | DateTime | | Start of overtime |
| overtimeEnd | DateTime? | | End of overtime (null until ended) |
| status | OvertimeStatus | Enum, Default PENDING | PENDING / APPROVED / COMPLETED / REJECTED |
| endConfirmed | Boolean | Default false | True once OVERTIME_END request is approved |
| reason | String? | | |
| createdAt | DateTime | Default now() | |

---

#### Holiday
A single-day holiday request for one employee.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | String | PK, UUID | |
| employeeId | String | FK → User | |
| declaredBy | String? | FK → User | Admin who approved |
| holidayDate | DateTime | @db.Date | The holiday date (date portion only) |
| description | String? | | |
| status | RequestStatus | Enum, Default PENDING | PENDING / APPROVED / REJECTED |
| createdAt | DateTime | Default now() | |

On approval: employee's `isActive` is set to `false`. A midnight cron job reactivates them the next day.

---

#### AttendanceHistory
Archive table. Live attendance records are moved here when the manager triggers archival. A cron job purges records older than 6 months.

| Field | Type | Notes |
|---|---|---|
| id | String | PK, UUID |
| employeeId | String | FK → User |
| employeeName | String | Denormalised name snapshot |
| date | DateTime | Original attendance date |
| checkInTime | DateTime? | |
| checkOutTime | DateTime? | |
| attendanceStatus | String? | Status string at time of archival |
| leaveFrom / leaveTo | DateTime? | Leave dates if applicable |
| leaveReason | String? | |
| leaveStatus | String? | |
| overtimeStart / End | DateTime? | |
| overtimeStatus | String? | |
| notes | String? | |
| archivedAt | DateTime | Default now() — timestamp of archival |

---

#### Notification
Role-scoped system notification. No WebSockets — clients poll for new notifications.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | String | PK, UUID | |
| fromRole | Role | Enum | Role that generated the notification |
| toRole | Role | Enum | Role that should see it |
| message | String | | Human-readable content |
| vehicleNumber | String? | | Context link |
| quotationId | String? | | Context link |
| userId | String? | FK → User | Context link |
| isRead | Boolean | Default false | |
| createdAt | DateTime | Default now() | |

---

### Enums

#### Role
```
EMPLOYEE   — Workshop technicians (unlimited accounts)
ADMIN      — Front-office staff (max 2 accounts)
MANAGER    — Management (max 2 accounts)
```

#### JobType
```
SERVICE            — Routine servicing
REPAIR             — Fault repair
ACCIDENT_RECOVERY  — Insurance claim work (requires insuranceCompany)
```

#### JobStatus
```
DRAFT       → Employee creating
SUBMITTED   → Awaiting admin review
REVIEWED    → Admin reviewed, quotation being prepared
QUOTED      → (transitional)
FINALIZED   → Manager finalised quotation; ready for delivery
COMPLETED   → Admin confirmed customer notified
```

#### ImagePhase
```
BEFORE   — Pre-work photos
AFTER    — Post-work photos
PART     — Spare part photos
```

#### QuotationStatus
```
DRAFT              → Admin building
SENT_TO_MANAGER    → Awaiting manager review/finalisation
FINALIZED          → Manager finalised; stock deducted
CUSTOMER_NOTIFIED  → Admin confirmed customer contacted; job closed
```

#### AttendanceStatus
```
PRESENT         — Normal working day
EARLY_CHECKOUT  — Left before closing time
OVERTIME        — Active overtime session
HOLIDAY         — Approved holiday
ON_LEAVE        — Approved leave
ABSENT          — No attendance record
```

#### AttendanceRequestType
```
CHECKIN         — Employee arriving
CHECKOUT        — Employee leaving (normal)
EARLY_CHECKOUT  — Employee leaving before closing
OVERTIME_START  — Beginning overtime
OVERTIME_END    — Ending overtime
LEAVE_START     — Beginning leave
LEAVE_END       — Confirming return from leave
HOLIDAY         — Single-day holiday request
```

#### RequestStatus
```
PENDING    — Awaiting admin decision
APPROVED   — Admin approved
REJECTED   — Admin rejected
```

#### LeaveStatus
```
PENDING    APPROVED    REJECTED
```

#### OvertimeStatus
```
PENDING    APPROVED    COMPLETED    REJECTED
```

---

## 4. User Roles & Authentication

### Role Limits
- **EMPLOYEE** — Unlimited accounts
- **ADMIN** — Maximum 2 accounts
- **MANAGER** — Maximum 2 accounts

### Sign-up Rules
- ADMIN and MANAGER self-register via the signup page
- EMPLOYEEs are created only by an ADMIN from the admin dashboard
- All new users except self-registered ADMIN/MANAGER have `isFirstLogin = true` and must change their password on first login

### Password Reset Flow
```
1. User submits email → backend sends 6-digit OTP via email (10-min expiry)
2. User submits OTP → backend returns 15-min reset token
3. User submits reset token + new password → password updated
```

### Account Deactivation
- ADMIN can deactivate an EMPLOYEE (`isActive = false`)
- Deactivated users cannot log in
- Holiday approval also sets employee to inactive; cron reactivates them the next day

---

## 5. Backend API Reference

**Base URL:** `http://localhost:5001/api`  
All protected routes require `Authorization: Bearer <JWT>` header.

---

### 5.1 Auth Routes (`/api/auth`)

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| POST | `/signin` | No | — | Login with email + password. Returns `{ user, token }`. Rejects if `isActive = false`. |
| POST | `/signup` | No | — | Self-register as ADMIN or MANAGER (max 2 each). Returns `{ user, token }`. |
| POST | `/change-password` | Yes | Any | Change password. Sets `isFirstLogin = false`. |
| POST | `/forgot-password` | No | — | Send OTP to email. Body: `{ email }`. |
| POST | `/verify-otp` | No | — | Validate OTP. Returns `{ resetToken }`. Body: `{ email, otp }`. |
| POST | `/reset-password` | No | — | Reset password using token. Body: `{ resetToken, newPassword }`. |
| GET | `/role-availability` | No | — | Returns `{ admin: { count, available }, manager: { count, available }, employee: { count } }`. |

---

### 5.2 Job Routes (`/api/jobs`)

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| POST | `/` | Yes | EMPLOYEE | Create a job in DRAFT status. Auto-creates Vehicle if not found. Body: `{ vehicleNumber, jobType, notes?, insuranceCompany?, voiceNoteUrl? }`. |
| PUT | `/:id` | Yes | EMPLOYEE | Update DRAFT job fields: notes, insuranceCompany, jobType, voiceNoteUrl. |
| PUT | `/:id/submit` | Yes | EMPLOYEE | Transition DRAFT → SUBMITTED. |
| GET | `/` | Yes | Any | EMPLOYEE: own jobs only. ADMIN/MANAGER: all SUBMITTED, REVIEWED, QUOTED jobs. |
| GET | `/:id` | Yes | Any | Full job details with vehicle, employee, images, quotations. |
| PUT | `/:id/review` | Yes | ADMIN | Transition SUBMITTED → REVIEWED. |

**Job Type Descriptions:**
- `SERVICE` — Routine monthly maintenance
- `REPAIR` — Mechanical or electrical repair
- `ACCIDENT_RECOVERY` — Body work and accident repairs (requires insurance company)

---

### 5.3 Quotation Routes (`/api/quotations`)

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| POST | `/` | Yes | ADMIN, MANAGER | Create quotation. `jobId` optional (auto-creates job if omitted). |
| GET | `/` | Yes | Any | MANAGER: SENT_TO_MANAGER, FINALIZED, CUSTOMER_NOTIFIED. ADMIN: all. |
| GET | `/:id` | Yes | Any | Full quotation with items, job (employee, images), vehicle, admin, manager. |
| PUT | `/:id` | Yes | ADMIN, MANAGER | Update quotation fields + replace all items. |
| PUT | `/:id/send` | Yes | ADMIN | DRAFT → SENT_TO_MANAGER. Requires `telephone` on quotation. |
| PUT | `/:id/finalize` | Yes | MANAGER | SENT_TO_MANAGER → FINALIZED. Atomic: update items, deduct inventory, create stock ledger entries, set job → FINALIZED, notify admin. Body: `{ items[], managerId, totalAmount }`. |
| PATCH | `/:id/notify` | Yes | ADMIN | FINALIZED → CUSTOMER_NOTIFIED. Sets job → COMPLETED, notifies manager. |

**Quotation Finalization (Atomic):**
1. Delete old quotation items
2. Create new items (links sparePartId if provided)
3. For each item with `sparePartId`: deduct `quantity` from SparePart, create StockLedger entry
4. Set quotation `status = FINALIZED`, set `totalAmount`, set `managerId`
5. Set job `status = FINALIZED`
6. Create MANAGER→ADMIN notification

---

### 5.4 Vehicle Routes (`/api/vehicles`)

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/:vehicleNumber` | Yes | Any | Lookup vehicle by registration. Returns vehicle fields for auto-fill. 404 if not found. |
| GET | `/` | Yes | Any | List all vehicles ordered by latest first. |

---

### 5.5 Image Routes (`/api/images`)

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| POST | `/upload` | Yes | Any | Multipart form. Fields: `jobId`, `phase` (BEFORE/AFTER/PART), `images[]` (max 20 files, 10 MB each), `captions[]`. Saves files to `uploads/` directory. |
| DELETE | `/:id` | Yes | Any | Delete JobImage record and remove file from filesystem. |

---

### 5.6 Employee Routes (`/api/employees`)

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/` | Yes | ADMIN, MANAGER | List all employees with job count, isActive, isFirstLogin status. |
| POST | `/` | Yes | ADMIN | Create employee. Validates unique email + NIC. New employee has `isFirstLogin = true`. Body: `{ name, email, nicNumber, address? }`. |
| PATCH | `/:id/status` | Yes | ADMIN | Toggle employee active/inactive. Body: `{ isActive: boolean }`. |

---

### 5.7 Attendance Routes (`/api/attendance`)

#### Employee Endpoints

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/today` | EMPLOYEE | Today's attendance record, all pending requests, active leave, active overtime, today's holiday. |
| GET | `/my` | EMPLOYEE | Full personal history: attendance records, requests, leaves, overtimes, holidays. |
| POST | `/checkin` | EMPLOYEE | Submit check-in request. Prevents duplicate same-day requests. Creates PENDING AttendanceRequest (CHECKIN). |
| POST | `/checkout` | EMPLOYEE | Submit check-out request. If before 18:30 and not overtime: EARLY_CHECKOUT type. Body: `{ reason? }`. |
| POST | `/overtime/start` | EMPLOYEE | Request overtime start. Body: `{ reason }`. |
| POST | `/overtime/end` | EMPLOYEE | Request overtime end. Body: `{ overtimeId }`. |
| POST | `/leave` | EMPLOYEE | Apply for leave. Body: `{ leaveFrom, leaveTo, reason? }`. Status = PENDING until admin approves. |
| POST | `/leave/confirm-end` | EMPLOYEE | Confirm return from leave. Body: `{ leaveId }`. Creates LEAVE_END request. |
| POST | `/holiday` | EMPLOYEE | Request a holiday day. Body: `{ holidayDate, description? }`. |

#### Admin Endpoints

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/admin/pending` | ADMIN, MANAGER | All pending items: requests (CHECKIN/CHECKOUT/EARLY_CHECKOUT/LEAVE_END), overtimes, leaves, holidays. |
| PUT | `/admin/request/:id/approve` | ADMIN | Approve check-in/out/early-checkout request. Creates/updates Attendance record with actual time. |
| PUT | `/admin/request/:id/reject` | ADMIN | Reject request. Body: `{ reason? }`. |
| PUT | `/admin/overtime/:id/approve` | ADMIN | Approve overtime. Creates Overtime record, updates Attendance overtimeStart/End. |
| PUT | `/admin/overtime/:id/reject` | ADMIN | Reject overtime. |
| PUT | `/admin/leave/:id/approve` | ADMIN | Approve leave. Notifies employee. |
| PUT | `/admin/leave/:id/reject` | ADMIN | Reject leave. Body: `{ reason? }`. |
| PUT | `/admin/holiday/:id/approve` | ADMIN | Approve holiday. Sets employee `isActive = false` until cron reactivates next day. |
| PUT | `/admin/holiday/:id/reject` | ADMIN | Reject holiday. |

#### Manager Endpoints

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/manager/overview` | MANAGER | Attendance metrics per employee for period. Query: `period` (weekly/monthly), `date?`. Returns per employee: daysPresent, leaveDays, overtimeHours, earlyCheckouts, holidayDays, currentStatus, conflict flags. |
| GET | `/manager/history` | MANAGER | Archived attendance history. Query: `employeeId?`, `startDate?`, `endDate?`. |
| GET | `/manager/employees` | MANAGER | All employees + today's live status snapshot (checked-in, on-leave, on-holiday, absent, etc.). |
| POST | `/manager/archive` | MANAGER | Move all Attendance records → AttendanceHistory table. Clears live attendance table. |

---

### 5.8 Inventory Routes (`/api/inventory`)

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/` | Yes | MANAGER | List all spare parts. Returns `{ parts[], totalValue }` (totalValue = sum of boughtPrice × quantity). |
| GET | `/search` | Yes | MANAGER | Search parts by name or serialNumber. Query: `q`. Limit 20 results. |
| POST | `/` | Yes | MANAGER | Create spare part. Validates unique serialNumber. Body: `{ name, serialNumber, description?, boughtPrice, sellingPrice, quantity, lowStockThreshold, supplierName?, supplierDetails?, purchaseDate? }`. |
| PUT | `/:id` | Yes | MANAGER | Update part fields. If `quantity` changes: creates StockLedger entry with `adjustmentReason`. Body includes `adjustmentReason?`. |
| DELETE | `/:id` | Yes | MANAGER | Delete spare part. |
| GET | `/:id/ledger` | Yes | MANAGER | Full stock ledger for part (all changes, newest first). |

---

### 5.9 Analytics Routes (`/api/analytics`)

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/summary` | Yes | MANAGER | Financial + inventory summary. Query: `range` (daily/weekly/monthly), `date?` (YYYY-MM-DD anchor). |

**Response structure:**
```json
{
  "period": { "range": "monthly", "start": "...", "end": "..." },
  "revenue": {
    "total": 150000,
    "cogs": 45000,
    "grossProfit": 105000,
    "profitMargin": 70.0
  },
  "jobs": {
    "total": 25,
    "finalized": 20,
    "finalizationRate": 80.0,
    "aov": 7500
  },
  "byCategory": [
    { "jobType": "REPAIR", "revenue": 80000, "cogs": 20000, "grossProfit": 60000, "jobCount": 12 }
  ],
  "inventory": {
    "totalValue": 320000,
    "dailyConsumption": 4500,
    "topByValue": [ { "name": "...", "quantity": 10, "stockValue": 12000, "lowStock": false } ]
  }
}
```

**COGS calculation:** `boughtPrice × quantity` for all spare parts consumed (via StockLedger negative entries) in the period.  
**Profit Margin:** `(grossProfit / revenue) × 100`  
**AOV (Average Order Value):** `totalRevenue / finalizedQuotationCount`

---

### 5.10 Notification Routes (`/api/notifications`)

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/` | Yes | Any | Fetch all notifications where `toRole = user.role`. |
| POST | `/` | Yes | Any | Create notification. `fromRole` auto-set from JWT. Body: `{ toRole, message, vehicleNumber?, quotationId?, userId? }`. |
| PUT | `/:id/read` | Yes | Any | Mark notification as read (`isRead = true`). |
| DELETE | `/:id` | Yes | Any | Delete notification. |

---

### 5.11 Search Routes (`/api/search`)

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/` | Yes | Any | Search vehicles and their full job history. Query: `q` (search term), `type` (vehicleNumber or telephone). Returns vehicle + jobs with images, employee details, quotations. |

---

### 5.12 Voice / AI Assistant Routes (`/api/voice`)

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| POST | `/upload` | Yes | Any | Upload audio file for job voice note. Multipart: `voice` (audio file, max 20 MB). Returns `{ url }`. |
| POST | `/query` | Yes | MANAGER | AI voice query. Multipart: `audio?` (audio file) + `text?` (fallback text) + `context?` (JSON string of page state). Requires `GROQ_API_KEY`. |

**AI Query Flow:**
1. If `audio` uploaded: Groq Whisper (`whisper-large-v3`) transcribes to text
2. LLaMA-3.3-70b classifies intent and extracts parameters
3. Read-only Prisma query executes based on intent
4. Returns structured response

**AI Query Response:**
```json
{
  "transcript": "Show me the service history for WP ABC 1234",
  "response": "Found 5 service records for WP-ABC-1234, owned by Kamal Perera.",
  "intent": "vehicle_history",
  "params": { "vehicleNumber": "WP-ABC-1234" },
  "data": { /* full vehicle + jobs + quotations + images */ }
}
```

**Supported Intents:**

| Intent | Trigger Example | DB Query | Action |
|---|---|---|---|
| `vehicle_history` | "Show history for WP-ABC-1234" | Vehicle → Jobs → Images → Quotations | Opens timeline modal in UI |
| `print_report` | "Print report for this vehicle" | Same as above | Generates + downloads PDF |
| `inventory_query` | "How many oil filters do we have?" | SparePart search / all parts summary | Shows stock data in chat |
| `employee_status` | "Is Nimal available today?" | User → Attendance + Leave + Holiday | Shows today's status |
| `financial_query` | "What's our profit this month?" | Quotations (FINALIZED) + StockLedger | Shows revenue/profit/margin |
| `general` | "What can you do?" | None | Text response only |

> **Security:** The AI agent is strictly read-only. It uses `SELECT` queries only via Prisma — no DELETE, UPDATE, or INSERT is possible through voice queries.

---

## 6. Scheduled Jobs (Cron)

Three cron jobs run on the backend server automatically.

### 6.1 Auto Early-Checkout Flag
**Schedule:** `30 18 * * 1-6` — Every weekday Monday–Saturday at 6:30 PM

**Behaviour:**
1. Finds all Attendance records for today where `checkInTime IS NOT NULL` AND `checkOutTime IS NULL`
2. For each: checks if an EARLY_CHECKOUT AttendanceRequest already exists today
3. If not: creates a PENDING EARLY_CHECKOUT request with reason "Auto-flagged: no checkout recorded by closing time"
4. Creates ADMIN notification: "⚠️ Auto-flag: {name} has no checkout recorded by closing time"

### 6.2 Holiday Reactivation
**Schedule:** `5 0 * * *` — Every day at 12:05 AM

**Behaviour:**
1. Finds all approved holidays where `holidayDate ≤ yesterday`
2. For each employee on that holiday: if `isActive = false`, sets `isActive = true`

### 6.3 Attendance History Cleanup
**Schedule:** `0 1 * * *` — Every day at 1:00 AM

**Behaviour:**
1. Deletes all `AttendanceHistory` records where `archivedAt < 6 months ago`
2. Logs count of deleted records

---

## 7. Frontend Dashboards

### 7.1 Employee Dashboard

**Route:** `/employee`  
**Tabs:** Create Job | History | Attendance

---

#### Tab: Create Job
Multi-step wizard for submitting a new job.

| Step | Description |
|---|---|
| 1. Select Type | Choose SERVICE / REPAIR / ACCIDENT_RECOVERY. Enter vehicle registration (auto-fills owner details). Enter insurance company if ACCIDENT_RECOVERY. |
| 2. Before Images | Upload before-work photos (drag-and-drop or file picker). Multiple images supported. |
| 3. After Images | Upload after-work photos. |
| 4. Notes & Voice | Enter notes. Optional: record a voice note (tap mic) or upload an audio file. |
| 5. Submit | Confirms and submits to admin queue. |

**Vehicle auto-fill:** When a vehicle registration is entered, the system looks up existing records and pre-fills owner name, telephone, address.

---

#### Tab: History
View all jobs created by the logged-in employee.

- Sorted newest first
- Shows job number, vehicle registration, job type, status badge, date
- Click any job to open detail modal with:
  - Before/After/Part images (gallery)
  - Employee name, notes, insurance company
  - Voice note player (if recorded)
  - All linked quotations with items and total amounts

---

#### Tab: Attendance
Real-time attendance management.

**Today's Status Card:**

| Action | Condition | Description |
|---|---|---|
| Check In | Not yet checked in, no pending request, no active leave/holiday | Opens confirmation modal → creates CHECKIN request |
| Check Out | Checked in, not yet checked out | If before 18:30 = EARLY_CHECKOUT (requires reason). After 18:30 = normal CHECKOUT. |
| Overtime Start | Checked in, checked out, no active OT | Request overtime with reason |
| Overtime End | Active approved overtime | Confirm end of overtime session |
| Apply for Leave | Not on leave | Date range picker + optional reason → creates PENDING Leave |
| Confirm Leave Return | On approved leave that has ended | Creates LEAVE_END request for admin to process |
| Request Holiday | Active employee | Single date picker + description → creates PENDING Holiday |

**Auto-prompt:** If employee opens the tab and hasn't checked in (and no pending request or active leave/holiday), the check-in modal opens automatically.

**Leave Countdown Timer:** When on approved leave, a live countdown shows time remaining until leave ends.

**My Attendance History:**
- Attendance records table (date, check-in, check-out, status)
- All pending requests with their type and status
- Leave records (from/to dates, reason, approval status)
- Overtime records (start/end, reason, approval status)
- Holiday requests (date, description, approval status)

---

### 7.2 Admin Dashboard

**Route:** `/admin`  
**Tabs:** Requests | Quotations | Delivery | Notifications | Search | Employees | Attendance

---

#### Tab: Requests
Job review queue.

- Lists all SUBMITTED and REVIEWED jobs
- Each job shows: vehicle number, job type, employee name, date, status badge
- **Review modal:**
  - Image gallery (before/after phases labelled)
  - Job notes and insurance company
  - Voice note player (if attached)
  - "Mark as Reviewed" button → SUBMITTED → REVIEWED

---

#### Tab: Quotations
Quotation creation and management.

- **List:** All quotations with status, vehicle, customer name, total amount
- **Create quotation from job:** Select a REVIEWED job → auto-fills vehicle details → add line items
  - Each line item: description, part replaced, quantity, price, labour cost
  - Can link spare parts from inventory
  - Grand total calculated live
- **Custom quotation:** Create without linking to a specific job (for walk-in customers)
- **Send to manager:** Validates that telephone number is present → DRAFT → SENT_TO_MANAGER
- **Edit quotation:** Modify customer details and line items
- **View details:** Full breakdown with all items

---

#### Tab: Delivery
Customer delivery management.

- Lists all FINALIZED quotations (ready for customer notification)
- **WhatsApp integration:**
  - Auto-composes a professional message with vehicle, service summary, total amount
  - "Send WhatsApp" button opens WhatsApp Web with pre-filled message to customer's number
- **Mark Notified:** After confirming customer contact → FINALIZED → CUSTOMER_NOTIFIED, Job → COMPLETED

---

#### Tab: Notifications
- Lists all system notifications addressed to ADMIN role
- Unread notifications shown with visual indicator
- Mark as read / Delete

---

#### Tab: Search
- Search by vehicle registration number or telephone number
- Displays full vehicle record with all historical jobs (images, quotations, employee info)

---

#### Tab: Employees
- List all employees with job count, status (active/inactive), first-login flag
- **Create employee:**
  - Fields: name, email, NIC number, address
  - Initial password generated; employee must change on first login
- **Activate/Deactivate:** Toggle with one click; deactivated employees cannot log in

---

#### Tab: Attendance
Pending approval queue with all attendance actions.

| Section | Description |
|---|---|
| Requests | CHECKIN, CHECKOUT, EARLY_CHECKOUT, LEAVE_END requests. Approve = creates/updates Attendance record. |
| Overtimes | Approve = creates Overtime record, updates Attendance overtimeStart/End. |
| Leaves | Approve/Reject with optional reason. Approval notifies employee. |
| Holidays | Approve = sets employee to inactive. Cron reactivates next day. |

---

### 7.3 Manager Dashboard

**Route:** `/manager`  
**Tabs:** Quotations | Search | Employees | Attendance | Inventory | Financials

---

#### Tab: Quotations
Manager's primary workflow tab.

- Lists all SENT_TO_MANAGER, FINALIZED, and CUSTOMER_NOTIFIED quotations
- **Finalize quotation:**
  - Edit customer details and all line items
  - Link line items to inventory parts (inventory search with live stock display)
  - Grand total calculated live
  - **Finalise button:** Atomically deducts inventory, creates stock ledger entries, transitions quotation and job status, notifies admin
- **View details:** Full quotation breakdown

---

#### Tab: Search
- Search vehicles by registration or telephone
- Displays full vehicle service history

---

#### Tab: Employees
- Read-only view of all employees with job counts and status
- Useful for assigning jobs and understanding workload

---

#### Tab: Attendance
Two views:

**Overview (weekly/monthly):**
- Date picker to select period
- Table of all employees with metrics:
  - Days present, leave days, overtime hours, early checkouts, holiday days
  - Current status (checked-in, on leave, on holiday, etc.)
  - Conflict flags (e.g., checked in but also on approved leave)
- **Archive button:** Moves all live attendance records to history table

**History:**
- Filter archived attendance by employee and date range
- Shows full historical attendance with leave/overtime/holiday context

---

#### Tab: Inventory
Full spare parts management.

- **Parts list:** Name, serial, quantity, prices, low-stock warning badge
- **Add part:** Form with all fields including supplier info
- **Edit part:** Update all fields; quantity changes auto-create stock ledger entry with reason
- **Delete part**
- **Stock ledger:** Click any part to see full change history (date, change amount, reason, linked quotation/job)
- **Part search during quotation:** When creating/editing a quotation, inline search lets manager pick a part from inventory — auto-fills description, price, and links `sparePartId`

---

#### Tab: Financials
Business intelligence dashboard.

- **Period selector:** Daily / Weekly / Monthly with date anchor
- **KPI Cards:**
  - Total Revenue
  - COGS (Cost of Goods Sold from stock ledger)
  - Gross Profit (Revenue − COGS)
  - Profit Margin %
  - Total Jobs / Finalized Jobs / Finalization Rate
  - Average Order Value (AOV)
  - Total Inventory Value
  - Daily Stock Consumption
- **Bar chart:** Revenue vs Gross Profit by job category (SERVICE / REPAIR / ACCIDENT_RECOVERY)
- **Top inventory table:** Top 10 parts by tied-up capital with units consumed in period and low-stock flag

---

## 8. AI Voice Assistant

The AI assistant is a floating widget on the Manager Dashboard (bottom-right corner). It allows the manager to query the workshop database using natural language — by voice or text — without leaving their current task.

### How It Works

```
Manager speaks/types
        ↓
[MediaRecorder / text input]
        ↓
POST /api/voice/query
        ↓
Groq Whisper → transcript
        ↓
LLaMA-3.3-70b → intent + params + response
        ↓
Prisma DB query (read-only)
        ↓
JSON response back to frontend
        ↓
Web Speech API speaks response aloud
+ Chat panel shows result
+ Action buttons appear for vehicle/print intents
```

### Interface

- **Floating button** (blue bot icon) in bottom-right corner with pulse animation
- **Chat panel** slides up showing conversation history
- **Text input** for typed queries
- **Voice button** (hold to record, release to send)
- **TTS playback** with stop button
- **Intent badges** label each AI response type (Vehicle History, Inventory, Financials, etc.)

### Voice Recording
- Uses browser `MediaRecorder` API
- Prefers `audio/webm;codecs=opus`, falls back to `audio/webm` then `audio/ogg`
- Minimum recording size check (prevents empty submissions)

### Context Awareness
If the manager is viewing a specific quotation, the assistant receives `{ vehicleNumber: "WP-ABC-1234" }` as context — so queries like "show me the history for this vehicle" work without specifying the plate.

### Action Integration

| Intent | UI Action |
|---|---|
| `vehicle_history` | Opens a full vehicle timeline modal with all jobs, images, and quotation items |
| `print_report` | Generates and downloads a jsPDF service history PDF with workshop letterhead |
| Both | Quick-action buttons appear in the chat bubble for one-click access |

### Vehicle History Modal
- Chronological timeline with dotted connector
- Each job shows: type, job number, date, technician, status, total amount, notes
- Inline item list (first 3 items + overflow count)
- Before/after image thumbnails
- Print Report button in header

### PDF Service History Report
Auto-generated with:
- Workshop name and report title
- Generation date
- Vehicle details table (registration, owner, type, colour, telephone)
- Jobs table (date, type, technician, status, amount)
- Downloaded as `service-history-WP-ABC-1234.pdf`

### Example Queries

```
"Show me the full service history for WP-ABC-1234"
"Generate a printable report for this vehicle"
"Do we have enough oil filters for 3 more services?"
"Is Nimal available to take a new job today?"
"What was our gross profit from accident recoveries this month?"
"What's our total revenue this week?"
"How many parts are low on stock?"
```

### Setup Requirement
The AI assistant requires a Groq API key:
```
GROQ_API_KEY="gsk_..."   # in backend/.env
```
Get a free key at **console.groq.com**. Without the key, the endpoint returns a 503 error with a clear message.

---

## 9. Core Business Flows

### 9.1 Complete Job-to-Delivery Flow

```
EMPLOYEE
  1. Create job (vehicle number, type, images, notes, voice note)
  2. Submit job → status: SUBMITTED

ADMIN
  3. Review job in Requests tab (view images, voice)
  4. Mark as reviewed → status: REVIEWED
  5. Create quotation (customer details, line items, spare parts)
  6. Send to manager → status: SENT_TO_MANAGER

MANAGER
  7. Open quotation, review and finalise
     → Inventory deducted atomically
     → Stock ledger entries created
     → status: FINALIZED
     → Job status: FINALIZED
     → Admin notified

ADMIN
  8. Open Delivery tab, confirm customer contact via WhatsApp
  9. Mark as Notified → status: CUSTOMER_NOTIFIED
     → Job status: COMPLETED
     → Manager notified
```

### 9.2 Attendance Approval Flow

```
EMPLOYEE
  1. Tap "Check In" → PENDING AttendanceRequest created

ADMIN
  2. See pending request in Attendance tab
  3. Approve → Attendance record created with actual checkInTime

CRON (18:30 Mon-Sat)
  4. If employee has no checkOutTime → auto-flag EARLY_CHECKOUT
  5. Admin sees flag, can approve/reject
```

### 9.3 Inventory Deduction Flow

```
MANAGER finalises quotation
  ↓
For each QuotationItem with sparePartId:
  1. SparePart.quantity -= item.quantity
  2. StockLedger.create({
       change: -item.quantity,
       reason: "Quotation finalised for WP-ABC-1234",
       quotationId: "...",
       jobNumber: 42
     })
  ↓
Low-stock check on next inventory view
```

### 9.4 Password Reset Flow

```
Employee forgets password
  1. Submit email → 6-digit OTP sent via email (10 min)
  2. Enter OTP → receives 15-min resetToken
  3. Enter resetToken + new password → done
```

---

## 10. Notifications System

The notification system is role-based and polling-based (no WebSockets).

### Auto-Generated Notifications

| Trigger | From | To | Message |
|---|---|---|---|
| Quotation finalised | MANAGER | ADMIN | Customer ready for notification |
| Customer notified | ADMIN | MANAGER | Job completed confirmation |
| Leave approved | ADMIN | EMPLOYEE | Leave approval notification |
| Holiday approved | ADMIN | EMPLOYEE | Holiday approval notification |
| Auto early-checkout (cron) | system | ADMIN | ⚠️ Auto-flag: {name} no checkout by closing time |

### Notification Fields
- `fromRole` / `toRole` — Role routing
- `message` — Human-readable content
- `vehicleNumber?` / `quotationId?` / `userId?` — Optional context links
- `isRead` — Read status

---

## 11. File Upload System

### Storage
All uploaded files stored at `backend/uploads/` (configurable via `UPLOAD_DIR` in `.env`).  
Served statically at `http://localhost:5001/uploads/<filename>`.

### Job Images
- Max: 20 images per upload request
- Max size: 10 MB per image
- Accepted: any image MIME type
- Named: `<uuid><extension>`

### Voice Notes (Job Attachment)
- Max size: 20 MB
- Accepted: `audio/*` and `video/*` MIME types
- Named: `<uuid>.webm` or `<uuid>.mp4`

### AI Voice Queries
- Uploaded to temp `uploads/` path
- Deleted from filesystem immediately after Groq transcription is complete

---

## 12. Environment Configuration

### Backend (`backend/.env`)

```env
DATABASE_URL="postgresql://postgres:password@localhost:5433/tracknfix"
JWT_SECRET="your-secret-key"
PORT=5001
UPLOAD_DIR="uploads"
NODE_ENV=development
EMAIL_USER="your_gmail@gmail.com"
EMAIL_PASS="your_gmail_app_password"
GROQ_API_KEY="gsk_..."
```

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | JWT signing secret (keep private) |
| `PORT` | No | Default: 5000 |
| `UPLOAD_DIR` | No | Default: `uploads` |
| `NODE_ENV` | No | `development` disables SSL cert verification for Groq API |
| `EMAIL_USER` | Yes (for OTP) | Gmail address |
| `EMAIL_PASS` | Yes (for OTP) | Gmail App Password (not your login password) |
| `GROQ_API_KEY` | Yes (for AI) | From console.groq.com |

### Frontend (`frontend/.env.local`)

```env
NEXT_PUBLIC_API_URL=http://localhost:5001/api
```

---

## 13. Project File Structure

```
Track & Fix 3.0/
├── backend/
│   ├── .env                          # Environment variables
│   ├── package.json                  # Dependencies
│   ├── tsconfig.json
│   ├── jest.config.ts                # Jest + ts-jest test runner config
│   ├── prisma/
│   │   └── schema.prisma             # Full database schema
│   ├── uploads/                      # Uploaded images and audio files
│   └── src/
│       ├── index.ts                  # App entry: routes, cron, server
│       ├── middleware/
│       │   └── auth.ts               # authenticate(), requireRole()
│       ├── lib/
│       │   └── prisma.ts             # Prisma singleton client
│       ├── __tests__/                # Jest test files (*.test.ts)
│       └── routes/
│           ├── auth.ts               # 7 endpoints
│           ├── jobs.ts               # 6 endpoints
│           ├── quotations.ts         # 7 endpoints
│           ├── vehicles.ts           # 2 endpoints
│           ├── images.ts             # 2 endpoints
│           ├── employees.ts          # 3 endpoints
│           ├── attendance.ts         # 18 endpoints
│           ├── inventory.ts          # 6 endpoints
│           ├── analytics.ts          # 1 endpoint
│           ├── notifications.ts      # 4 endpoints
│           ├── search.ts             # 1 endpoint
│           └── voice.ts              # 2 endpoints (upload + AI query)
│
└── frontend/
    ├── package.json
    ├── next.config.ts
    ├── app/
    │   ├── layout.tsx                # Root layout with AuthContext
    │   ├── page.tsx                  # Root redirect
    │   ├── login/page.tsx            # Login page
    │   ├── signup/page.tsx           # ADMIN/MANAGER signup
    │   ├── forgot-password/page.tsx  # OTP password reset
    │   ├── change-password/page.tsx  # First-login password change
    │   ├── employee/page.tsx         # Employee dashboard (3 tabs)
    │   ├── admin/page.tsx            # Admin dashboard (7 tabs)
    │   └── manager/page.tsx          # Manager dashboard (6 tabs)
    ├── components/
    │   ├── AIAssistant.tsx           # Floating AI voice/text assistant
    │   ├── DashboardLayout.tsx       # Header, navigation, logout
    │   └── ImageUploader.tsx         # Drag-drop image upload widget
    ├── context/
    │   └── AuthContext.tsx           # Global auth state (user, token, logout)
    └── lib/
        ├── api.ts                    # Axios client + all API method groups
        └── utils.ts                  # formatDate(), JOB_TYPE_LABELS, etc.
```

---

## 14. Full System Workflow

TrackNFix 3.0 is built around a linear, role-gated job lifecycle that moves a vehicle service request from the workshop floor all the way through to customer delivery, with inventory deduction, attendance management, and financial reporting woven into the same workflow. The following narrative describes how the system operates end-to-end in a typical working day.

### Authentication and Access

Every interaction with the system begins with authentication. Administrators and Managers self-register on the signup page; the system enforces a hard limit of two accounts per role to prevent privilege sprawl. Employees are never allowed to self-register — an Admin creates each employee account from the admin dashboard, generating an initial password and setting the account to first-login mode. When an employee logs in for the first time they are immediately redirected to a mandatory password-change screen before they can access anything else. All three roles authenticate using an email-and-password form, which returns a JWT token with a seven-day expiry. That token is stored in the browser's localStorage under the key `tnf_token` and is attached as a Bearer header to every subsequent API request. The backend validates the token and the role on every protected route, so a user cannot reach data or actions above their permission level.

### Job Creation (Employee)

The core unit of work in TrackNFix is a job. When a vehicle arrives at the workshop, an employee opens the Employee Dashboard and steps through a five-stage wizard to create the job. In the first step they select the job type — routine Service, a Repair, or Accident Recovery — and enter the vehicle registration number. If that vehicle has been serviced before, the system retrieves the owner's name, telephone number, and address automatically. If the vehicle is new to the system it is created on the fly. Accident Recovery jobs additionally require an insurance company name to be recorded. In the second and third steps the employee uploads before-work and after-work photographs using a drag-and-drop uploader; each image is stored on the backend as a UUID-named file under the `uploads/` directory. The fourth step allows the employee to write notes about the job and optionally attach a voice note — either recorded directly in the browser or uploaded as an audio file. Once satisfied, the employee submits the job in step five, transitioning it from DRAFT to SUBMITTED status and placing it in the admin's review queue.

### Job Review and Quotation (Admin)

The Admin Dashboard's Requests tab shows all SUBMITTED and REVIEWED jobs. The admin opens the review modal for each job, where they can play the voice note, browse the before-and-after image gallery, read the employee's notes, and check the vehicle details. When the admin is satisfied that the job is properly documented they mark it as reviewed, advancing the status from SUBMITTED to REVIEWED. The job now appears in the Quotations tab where the admin creates a formal quotation against it. The admin fills in customer contact details and adds line items, each of which captures a description, the part replaced, quantity, unit price, and labour cost. Line items can optionally be linked to spare parts held in inventory, which allows the manager to later deduct stock automatically. A live grand total is calculated as items are added. When the quotation is ready, the admin sends it to the manager — a step that validates that a customer telephone number is present — transitioning the quotation status to SENT_TO_MANAGER. If a walk-in customer arrives without a prior job on record, the admin can also create a standalone quotation not linked to any specific job.

### Quotation Finalisation and Inventory Deduction (Manager)

The Manager Dashboard's Quotations tab surfaces all quotations that have been sent for review. The manager opens each quotation, can edit any customer detail or line item, and links line items to inventory spare parts using an inline search that shows live stock quantities. Once the manager is satisfied, they click Finalise. This action is atomic: for every line item linked to a spare part, the system simultaneously subtracts the consumed quantity from the part's stock count and writes an immutable entry to the stock ledger recording the change, the reason, and the linked quotation and job numbers. The quotation status advances to FINALIZED, the parent job status advances to FINALIZED, and a notification is sent to the admin indicating that the customer is ready to be contacted. If any part's remaining stock falls below its defined threshold, a low-stock warning badge appears on the Inventory tab.

### Customer Delivery and Job Completion (Admin)

The Delivery tab of the Admin Dashboard lists all FINALIZED quotations. For each one, the admin can click a button that opens WhatsApp Web with a professionally worded message pre-composed — addressed to the customer's registered telephone number and summarising the service, vehicle, and total amount due. Once the admin has confirmed that the customer has been contacted, they mark the quotation as Notified. This transitions the quotation status to CUSTOMER_NOTIFIED and the job status to COMPLETED, and triggers a notification back to the manager confirming that the job has been closed out.

### Attendance Management

Attendance runs in parallel with the job workflow and affects whether an employee is considered available. Every day, when an employee arrives at the workshop, they tap Check In on the Attendance tab of the Employee Dashboard. This creates a PENDING attendance request visible to the admin. The admin reviews and approves the request, at which point a formal attendance record is created timestamped to the actual check-in time. Check-out follows the same approval pattern: if an employee leaves before the 18:30 closing time, the system classifies the request as an early checkout and requires the employee to provide a reason. A scheduled cron job runs at 18:30 on Monday through Saturday and automatically flags any employee who has a check-in record but no approved checkout for that day, creating an early-checkout record and notifying the admin.

Employees can also apply for leave by selecting a date range on the Attendance tab. The admin approves or rejects the request; approval triggers a notification to the employee. While on approved leave, the employee's dashboard shows a live countdown timer to their leave end date. When the leave period ends, the employee must actively confirm their return, which creates a LEAVE_END request for the admin to process. Similarly, employees can request a single-day holiday: admin approval temporarily sets the employee to inactive, and a scheduled cron job running at midnight reactivates them the following day. Managers have a full overview of attendance across all employees — filterable by week or month — showing days present, leave days, overtime hours, early checkouts, and holiday days per person. They can also archive live attendance records to a history table, from which a separate cron job purges entries older than six months.

### Inventory Management

The Manager Dashboard's Inventory tab provides complete visibility and control over spare parts. The manager can add new parts with a name, serial number, current quantity, unit cost, selling price, supplier name, and purchase date. Editing a part's quantity automatically creates a stock ledger entry so that every change is auditable. The stock ledger for any individual part can be inspected to see a complete history of increases and decreases — the date, the amount changed, the human-readable reason, and the linked quotation or job if the change originated from a finalised quotation. Parts whose stock falls below the defined minimum quantity are flagged with a low-stock warning badge across all inventory views.

### Financial Reporting

The Financials tab gives the manager a real-time view of the workshop's financial health. The manager selects a period — daily, weekly, or monthly — and the system aggregates all FINALIZED quotations within that window to compute total revenue, cost of goods sold (derived from the stock ledger), gross profit, profit margin percentage, total jobs, finalisation rate, average order value, total inventory value, and daily stock consumption. A bar chart breaks down revenue versus gross profit by job category — Service, Repair, and Accident Recovery — allowing the manager to see at a glance which type of work is most profitable. A top-10 table ranks spare parts by the capital tied up in current stock, alongside the units consumed in the selected period and a low-stock flag.

### AI Voice Assistant

The Manager Dashboard features a floating AI assistant, accessible from the bottom-right corner of every page. The manager can either hold a microphone button to speak a natural-language question or type a query into a text box. When a voice query is submitted, the audio is sent to the Groq Whisper model for transcription, and the resulting text — along with any page context such as the currently viewed vehicle registration — is passed to a LLaMA-3.3-70B model that identifies the intent, extracts parameters, and formulates a plain-English answer by querying the database. The response is spoken aloud via the browser's Web Speech API and displayed in a chat panel alongside an intent badge indicating whether the query was about vehicle history, inventory, financials, or staff availability. For vehicle history queries, quick-action buttons appear directly in the chat bubble allowing the manager to open a full service timeline modal or generate and download a PDF service history report — all without navigating away from the current screen.

### Notifications


The notification system keeps all three roles informed without requiring a page reload. Notifications are generated automatically at key workflow transitions: when a manager finalises a quotation, an admin is notified that the customer is ready for contact; when the admin marks a customer as notified, the manager receives a job-completion confirmation; when a leave or holiday is approved, the employee receives an approval notice; and when the cron job flags an early checkout, the admin is alerted. Notifications are scoped by role — each user sees only the notifications addressed to their role — and can be marked as read or deleted from the Notifications tab of the relevant dashboard.

### Search
Both the Admin and Manager dashboards include a vehicle search tool. Searching by vehicle registration number or customer telephone number returns the full vehicle record along with its entire service history: every job ever linked to that vehicle, including job type, status, assigned employee, images, voice notes, and all quotation items with their costs. This gives front-desk staff an immediate answer to any customer query about past work without navigating through job lists.

---

## 15. Testing

The backend has a Jest-based test suite using `ts-jest` for TypeScript support and `supertest` for HTTP integration tests.

### Setup

| Package | Role |
|---|---|
| `jest` | Test runner |
| `ts-jest` | TypeScript transformer for Jest |
| `supertest` | HTTP assertion library for Express route tests |
| `@types/jest` | TypeScript types for Jest globals |
| `@types/supertest` | TypeScript types for supertest |

Configuration is in [backend/jest.config.ts](backend/jest.config.ts):
- `preset: 'ts-jest'` — transpiles TypeScript directly without a separate build step
- `testEnvironment: 'node'` — runs tests in a Node.js environment
- Test files must be placed in `backend/src/__tests__/` and named `*.test.ts`

### NPM Scripts

```bash
npm test              # Run all tests once
npm run test:watch    # Re-run tests on file changes
npm run test:coverage # Run tests and generate a coverage report
```

### Writing Tests

Place test files under `backend/src/__tests__/`. Use `supertest` to test API routes against the Express app directly (no server needs to be running):

```typescript
import request from 'supertest';
import app from '../index';  // export the Express app

describe('GET /api/jobs', () => {
    it('returns 401 without a token', async () => {
        const res = await request(app).get('/api/jobs');
        expect(res.status).toBe(401);
    });
});
```

---

*TrackNFix 3.0 — Jayakody Auto Electrical Workshop Management System*
