/**
 * api.ts — Centralised API Client
 *
 * Exports a configured Axios instance (`api`) and a set of typed service
 * objects that map every backend endpoint to a named function.
 *
 * Architecture benefits:
 *  - All API calls go through one base URL (NEXT_PUBLIC_API_URL).
 *  - The request interceptor automatically attaches the JWT from localStorage,
 *    so individual components never need to manage the Authorization header.
 *  - Grouping endpoints by domain (authAPI, jobsAPI, etc.) makes imports
 *    self-documenting and keeps components decoupled from raw URL strings.
 *
 * Environment variables:
 *   NEXT_PUBLIC_API_URL – Backend base URL (defaults to http://localhost:5001/api)
 */

import axios from "axios";

// ── Axios Instance ────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";

/**
 * Shared Axios instance with the backend base URL pre-configured.
 * All API service objects below use this instance.
 */
export const api = axios.create({
    baseURL: API_BASE,
    withCredentials: false, // JWT is sent via Authorization header, not cookies
});

// ── Request Interceptor ───────────────────────────────────────────────────────

/**
 * Automatically injects the JWT bearer token into every outgoing request.
 * Reads from localStorage on the client side only (typeof window guard prevents
 * SSR errors in Next.js server components).
 */
api.interceptors.request.use((config) => {
    if (typeof window !== "undefined") {
        const token = localStorage.getItem("tnf_token");
        if (token) config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// ── Auth API ──────────────────────────────────────────────────────────────────

/** Authentication and password management endpoints. */
export const authAPI = {
    /** Self-register a new ADMIN or MANAGER account */
    signup:           (data: object) => api.post("/auth/signup", data),
    /** Sign in with email and password, returns user profile and JWT */
    signin:           (data: object) => api.post("/auth/signin", data),
    /** Check how many ADMIN/MANAGER slots remain */
    roleAvailability: () => api.get("/auth/role-availability"),
    /** Change password (required on first login) */
    changePassword:   (data: object) => api.post("/auth/change-password", data),
    /** Send a 6-digit OTP to the user's email for password reset */
    forgotPassword:   (data: object) => api.post("/auth/forgot-password", data),
    /** Validate the OTP and receive a short-lived reset token */
    verifyOtp:        (data: object) => api.post("/auth/verify-otp", data),
    /** Set a new password using the reset token from verifyOtp */
    resetPassword:    (data: object) => api.post("/auth/reset-password", data),
};

// ── Jobs API ──────────────────────────────────────────────────────────────────

/** Job card lifecycle management. */
export const jobsAPI = {
    /** Employee creates a new job in DRAFT status */
    create: (data: object) => api.post("/jobs", data),
    /** Employee updates a DRAFT job before submission */
    update: (id: string, data: object) => api.put(`/jobs/${id}`, data),
    /** Employee submits a DRAFT job for admin review (DRAFT → SUBMITTED) */
    submit: (id: string) => api.put(`/jobs/${id}/submit`),
    /** List jobs (role-filtered: employee sees own; admin sees submitted/reviewed/quoted) */
    list:   () => api.get("/jobs"),
    /** Get full details of a single job including images and quotations */
    get:    (id: string) => api.get(`/jobs/${id}`),
    /** Admin marks a submitted job as reviewed (SUBMITTED → REVIEWED) */
    review: (id: string) => api.put(`/jobs/${id}/review`),
};

// ── Images API ────────────────────────────────────────────────────────────────

/** Vehicle/job image upload and deletion. */
export const imagesAPI = {
    /** Upload one or more images as multipart/form-data */
    upload: (formData: FormData) =>
        api.post("/images/upload", formData, { headers: { "Content-Type": "multipart/form-data" } }),
    /** Delete an image by ID */
    delete: (id: string) => api.delete(`/images/${id}`),
};

// ── Voice API ─────────────────────────────────────────────────────────────────

/** AI voice assistant — Groq Whisper transcription + LLaMA intent processing. */
export const voiceAPI = {
    /** Upload a voice recording for transcription (used for job voice notes) */
    upload: (formData: FormData) =>
        api.post("/voice/upload", formData, { headers: { "Content-Type": "multipart/form-data" } }),
    /**
     * Send a voice query to the AI assistant.
     * NOTE: Do NOT manually set Content-Type — the browser must set it with the multipart boundary.
     */
    query:     (formData: FormData) => api.post("/voice/query", formData),
    /** Send a text query to the AI assistant (used when typing instead of speaking) */
    queryText: (text: string, context?: Record<string, string>) =>
        api.post("/voice/query", { text, context: context ? JSON.stringify(context) : undefined }),
};

// ── Quotations API ────────────────────────────────────────────────────────────

/** Quotation creation and workflow management. */
export const quotationsAPI = {
    /** Create a new quotation (Admin/Manager) */
    create:       (data: object) => api.post("/quotations", data),
    /** List quotations (role-filtered) */
    list:         () => api.get("/quotations"),
    /** Get a single quotation with all related data */
    get:          (id: string) => api.get(`/quotations/${id}`),
    /** Edit quotation details and line items */
    update:       (id: string, data: object) => api.put(`/quotations/${id}`, data),
    /** Admin sends a DRAFT quotation to the manager for review */
    send:         (id: string) => api.put(`/quotations/${id}/send`),
    /** Manager finalises the quotation with agreed prices and deducts inventory */
    finalize:     (id: string, data: object) => api.put(`/quotations/${id}/finalize`, data),
    /** Admin marks the customer as notified via WhatsApp */
    markNotified: (id: string) => api.patch(`/quotations/${id}/notify`),
};

// ── Vehicles API ──────────────────────────────────────────────────────────────

/** Vehicle lookup and history. */
export const vehiclesAPI = {
    /** Get vehicle details and job history by registration number */
    lookup: (vehicleNumber: string) => api.get(`/vehicles/${encodeURIComponent(vehicleNumber)}`),
    /** List all vehicles in the system */
    list:   () => api.get("/vehicles"),
};

// ── Search API ────────────────────────────────────────────────────────────────

/** Global search across vehicles and quotations. */
export const searchAPI = {
    /** Search by vehicle registration number or customer telephone */
    search: (q: string, type: "vehicleNumber" | "telephone") =>
        api.get(`/search?q=${encodeURIComponent(q)}&type=${type}`),
};

// ── Notifications API ─────────────────────────────────────────────────────────

/** In-app notification feed. */
export const notificationsAPI = {
    /** List all notifications for the current user */
    list:     () => api.get("/notifications"),
    /** Create a new notification (used internally) */
    create:   (data: object) => api.post("/notifications", data),
    /** Mark a single notification as read */
    markRead: (id: string) => api.put(`/notifications/${id}/read`),
    /** Delete a notification */
    delete:   (id: string) => api.delete(`/notifications/${id}`),
};

// ── Employees API ─────────────────────────────────────────────────────────────

/** Employee account management (Admin/Manager). */
export const employeesAPI = {
    /** List all employees with job count */
    list:         () => api.get("/employees"),
    /** Admin creates a new employee account with a temporary password */
    create:       (data: object) => api.post("/employees", data),
    /** Admin activates or deactivates an employee account */
    toggleStatus: (id: string, isActive: boolean) =>
        api.patch(`/employees/${id}/status`, { isActive }),
};

// ── Analytics API ─────────────────────────────────────────────────────────────

/** Financial analytics and KPI data (Manager only). */
export const analyticsAPI = {
    /** Get financial summary for a given period (daily/weekly/monthly) */
    summary: (range: "daily" | "weekly" | "monthly", date?: string) =>
        api.get(`/analytics/summary?range=${range}${date ? `&date=${date}` : ""}`),
};

// ── Inventory API ─────────────────────────────────────────────────────────────

/** Spare parts inventory management (Manager only). */
export const inventoryAPI = {
    /** List all spare parts with total inventory value */
    list:   () => api.get("/inventory"),
    /** Search parts by name or serial number */
    search: (q: string) => api.get(`/inventory/search?q=${encodeURIComponent(q)}`),
    /** Add a new spare part */
    create: (data: object) => api.post("/inventory", data),
    /** Edit part details or manually adjust stock quantity */
    update: (id: string, data: object) => api.put(`/inventory/${id}`, data),
    /** Remove a spare part from inventory */
    delete: (id: string) => api.delete(`/inventory/${id}`),
    /** Get the stock change history (ledger) for a specific part */
    ledger: (id: string) => api.get(`/inventory/${id}/ledger`),
};

// ── Attendance API ────────────────────────────────────────────────────────────

/** Attendance, leave, overtime, and holiday management. */
export const attendanceAPI = {
    // ── Employee actions ───────────────────────────────────────────────────
    /** Get today's attendance status for the logged-in employee */
    today:           () => api.get("/attendance/today"),
    /** Get the full attendance history for the logged-in employee */
    my:              () => api.get("/attendance/my"),
    /** Submit a check-in request for admin approval */
    checkIn:         () => api.post("/attendance/checkin"),
    /** Submit a checkout request (auto-detects early checkout before 18:30) */
    checkOut:        (reason?: string) => api.post("/attendance/checkout", { reason }),
    /** Request admin approval to begin overtime */
    overtimeStart:   (reason: string) => api.post("/attendance/overtime/start", { reason }),
    /** Confirm end of overtime */
    overtimeEnd:     (overtimeId: string) => api.post("/attendance/overtime/end", { overtimeId }),
    /** Apply for leave with a date range */
    applyLeave:      (data: { leaveFrom: string; leaveTo: string; reason?: string }) =>
        api.post("/attendance/leave", data),
    /** Confirm return from leave */
    confirmLeaveEnd: (leaveId: string) => api.post("/attendance/leave/confirm-end", { leaveId }),
    /** Request a personal holiday day */
    requestHoliday:  (data: { holidayDate: string; description?: string }) =>
        api.post("/attendance/holiday", data),

    // ── Admin actions ──────────────────────────────────────────────────────
    /** Get all pending attendance requests for admin review */
    adminPending:    () => api.get("/attendance/admin/pending"),
    approveRequest:  (id: string) => api.put(`/attendance/admin/request/${id}/approve`),
    rejectRequest:   (id: string, reason?: string) =>
        api.put(`/attendance/admin/request/${id}/reject`, { reason }),
    approveLeave:    (id: string) => api.put(`/attendance/admin/leave/${id}/approve`),
    rejectLeave:     (id: string, reason?: string) =>
        api.put(`/attendance/admin/leave/${id}/reject`, { reason }),
    approveOvertime: (id: string) => api.put(`/attendance/admin/overtime/${id}/approve`),
    rejectOvertime:  (id: string, reason?: string) =>
        api.put(`/attendance/admin/overtime/${id}/reject`, { reason }),
    approveHoliday:  (id: string) => api.put(`/attendance/admin/holiday/${id}/approve`),
    rejectHoliday:   (id: string) => api.put(`/attendance/admin/holiday/${id}/reject`),

    // ── Manager actions ────────────────────────────────────────────────────
    /** Get aggregated team attendance metrics (weekly/monthly) */
    overview:         (period: "weekly" | "monthly", date?: string) =>
        api.get(`/attendance/manager/overview?period=${period}${date ? `&date=${date}` : ""}`),
    /** Get archived attendance history records */
    history:          (params?: { employeeId?: string; startDate?: string; endDate?: string }) =>
        api.get("/attendance/manager/history", { params }),
    /** Archive current attendance records to history table */
    archive:          () => api.post("/attendance/manager/archive"),
    /** Get live status snapshot for all employees */
    managerEmployees: () => api.get("/attendance/manager/employees"),
};
