# TrackNFix 3.0

A full-stack vehicle service management system for **Jayakody Auto Electrical** workshop — digitising the entire workflow from job intake through quotation, inventory deduction, and customer delivery, with an AI voice assistant for management.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js · Express · TypeScript · Prisma ORM |
| Frontend | Next.js 16 (App Router) · React 19 · Tailwind CSS v4 |
| Database | PostgreSQL |
| AI | Groq Whisper (STT) · LLaMA-3.3-70B (NLU) |
| Auth | JWT (7-day expiry) |

---

## Features

- **Job Tracking** — Multi-step job lifecycle from intake to completion with image and voice note attachments
- **Quotation Management** — Admin creates quotations; Manager finalises with atomic inventory deduction
- **Inventory Control** — Spare parts with immutable stock ledger and low-stock alerts
- **Attendance System** — Check-in/out, leave, overtime, and holidays — all approval-based
- **Financial Analytics** — Revenue, COGS, gross profit, profit margin, and per-category breakdown
- **Vehicle History** — Full service timeline per registration plate
- **AI Voice Assistant** — Natural language queries via voice or text on the Manager dashboard
- **WhatsApp Integration** — Pre-composed delivery messages to customers

---

## Architecture

```
┌─────────────────────────────────────────────┐
│              CLIENT BROWSER                 │
│  Next.js 16 App Router (localhost:3000)     │
│  React 19 · Tailwind CSS v4 · Axios         │
└──────────────┬──────────────────────────────┘
               │ HTTP/REST (JWT Bearer)
               ▼
┌─────────────────────────────────────────────┐
│         EXPRESS BACKEND (localhost:5001)    │
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

---

## User Roles

| Role | Limit | Capabilities |
|---|---|---|
| **EMPLOYEE** | Unlimited | Create/submit jobs, manage own attendance |
| **ADMIN** | Max 2 | Review jobs, create quotations, manage employees and attendance |
| **MANAGER** | Max 2 | Finalise quotations, manage inventory, view financials, use AI assistant |

---

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL running on port 5433
- A [Groq API key](https://console.groq.com) (free tier available — required for AI assistant)
- Gmail App Password (required for OTP password reset)

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd "Track & Fix 3.0"

# Install all dependencies (root + backend + frontend)
npm run install:all
```

### Environment Setup

**Backend** — create `backend/.env`:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5433/tracknfix"
JWT_SECRET="your-secret-key-change-this"
PORT=5001
UPLOAD_DIR="uploads"
NODE_ENV=development
EMAIL_USER="your_gmail@gmail.com"
EMAIL_PASS="your_gmail_app_password"
GROQ_API_KEY="gsk_..."
```

**Frontend** — create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:5001/api
```

### Database Setup

```bash
cd backend
npx prisma migrate dev
npx prisma generate
```

### Run

```bash
# From the root — starts both backend (5001) and frontend (3000) concurrently
npm run dev
```

---

## Project Structure

```
Track & Fix 3.0/
├── backend/
│   ├── prisma/schema.prisma       # Database schema
│   ├── uploads/                   # Uploaded images and audio files
│   └── src/
│       ├── index.ts               # App entry: routes, cron, server
│       ├── middleware/auth.ts     # authenticate(), requireRole()
│       ├── lib/prisma.ts          # Prisma singleton client
│       ├── __tests__/             # Jest test files
│       └── routes/
│           ├── auth.ts            # Authentication + password reset
│           ├── jobs.ts            # Job lifecycle
│           ├── quotations.ts      # Quotation management
│           ├── vehicles.ts        # Vehicle lookup
│           ├── images.ts          # Image upload/delete
│           ├── employees.ts       # Employee management
│           ├── attendance.ts      # Full attendance system
│           ├── inventory.ts       # Spare parts + stock ledger
│           ├── analytics.ts       # Financial reporting
│           ├── notifications.ts   # Role-scoped notifications
│           ├── search.ts          # Vehicle/telephone search
│           └── voice.ts           # Job voice notes + AI assistant
│
└── frontend/
    ├── app/
    │   ├── employee/page.tsx      # Employee dashboard (3 tabs)
    │   ├── admin/page.tsx         # Admin dashboard (7 tabs)
    │   └── manager/page.tsx       # Manager dashboard (6 tabs)
    ├── components/
    │   ├── AIAssistant.tsx        # Floating AI voice/text assistant
    │   ├── DashboardLayout.tsx    # Header, navigation, logout
    │   └── ImageUploader.tsx      # Drag-drop image upload
    ├── context/AuthContext.tsx    # Global auth state
    └── lib/
        ├── api.ts                 # Axios client + all API methods
        └── utils.ts               # Helpers and constants
```

---

## Job Lifecycle

```
EMPLOYEE  →  Create job (images, voice note, notes)
          →  Submit  ──────────────────────────────►  SUBMITTED

ADMIN     →  Review job
          →  Mark Reviewed  ──────────────────────►  REVIEWED
          →  Create quotation + send to manager  ──►  SENT_TO_MANAGER

MANAGER   →  Finalise quotation (deducts inventory) ►  FINALIZED
                                                        Job: FINALIZED

ADMIN     →  Contact customer via WhatsApp
          →  Mark Notified  ──────────────────────►  CUSTOMER_NOTIFIED
                                                        Job: COMPLETED
```

---

## AI Voice Assistant

Available exclusively on the Manager dashboard (floating button, bottom-right).

**Supported queries:**

| Intent | Example |
|---|---|
| Vehicle history | "Show me the full history for WP-ABC-1234" |
| Print report | "Generate a service report for this vehicle" |
| Inventory | "Do we have enough oil filters for 3 more services?" |
| Employee status | "Is Nimal available today?" |
| Financial | "What was our gross profit this month?" |

The assistant is **strictly read-only** — it cannot modify any data.

Requires `GROQ_API_KEY` in `backend/.env`. Without it, the endpoint returns a 503 with a clear message.

---

## Scheduled Jobs (Cron)

| Schedule | Task |
|---|---|
| Mon–Sat 18:30 | Auto-flag employees with no checkout recorded |
| Daily 00:05 | Reactivate employees after an approved holiday |
| Daily 01:00 | Purge attendance history older than 6 months |

---

## API Overview

**Base URL:** `http://localhost:5001/api`  
All protected routes require `Authorization: Bearer <token>`.

| Route group | Prefix |
|---|---|
| Authentication | `/api/auth` |
| Jobs | `/api/jobs` |
| Quotations | `/api/quotations` |
| Vehicles | `/api/vehicles` |
| Images | `/api/images` |
| Employees | `/api/employees` |
| Attendance | `/api/attendance` |
| Inventory | `/api/inventory` |
| Analytics | `/api/analytics` |
| Notifications | `/api/notifications` |
| Search | `/api/search` |
| Voice / AI | `/api/voice` |

For full endpoint documentation see [SYSTEM_DOCUMENTATION.md](SYSTEM_DOCUMENTATION.md).

---

## Testing

```bash
cd backend
npm test                # Run all tests
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
```

Tests use Jest + ts-jest + supertest. Place test files in `backend/src/__tests__/` named `*.test.ts`.

---

## Build

```bash
npm run build   # Builds both backend and frontend for production
```

---


