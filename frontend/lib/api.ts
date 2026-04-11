import axios from "axios";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";

export const api = axios.create({
    baseURL: API_BASE,
    withCredentials: false,
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
    if (typeof window !== "undefined") {
        const token = localStorage.getItem("tnf_token");
        if (token) config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Auth
export const authAPI = {
    signup: (data: object) => api.post("/auth/signup", data),
    signin: (data: object) => api.post("/auth/signin", data),
    roleAvailability: () => api.get("/auth/role-availability"),
    changePassword: (data: object) => api.post("/auth/change-password", data),
    forgotPassword: (data: object) => api.post("/auth/forgot-password", data),
    verifyOtp: (data: object) => api.post("/auth/verify-otp", data),
    resetPassword: (data: object) => api.post("/auth/reset-password", data),
};

// Jobs
export const jobsAPI = {
    create: (data: object) => api.post("/jobs", data),
    update: (id: string, data: object) => api.put(`/jobs/${id}`, data),
    submit: (id: string) => api.put(`/jobs/${id}/submit`),
    list: () => api.get("/jobs"),
    get: (id: string) => api.get(`/jobs/${id}`),
    review: (id: string) => api.put(`/jobs/${id}/review`),
};

// Images
export const imagesAPI = {
    upload: (formData: FormData) =>
        api.post("/images/upload", formData, { headers: { "Content-Type": "multipart/form-data" } }),
    delete: (id: string) => api.delete(`/images/${id}`),
};

// Voice
export const voiceAPI = {
    upload: (formData: FormData) =>
        api.post("/voice/upload", formData, { headers: { "Content-Type": "multipart/form-data" } }),
};

// Quotations
export const quotationsAPI = {
    create: (data: object) => api.post("/quotations", data),
    list: () => api.get("/quotations"),
    get: (id: string) => api.get(`/quotations/${id}`),
    update: (id: string, data: object) => api.put(`/quotations/${id}`, data),
    send: (id: string) => api.put(`/quotations/${id}/send`),
    finalize: (id: string, data: object) => api.put(`/quotations/${id}/finalize`, data),
    markNotified: (id: string) => api.patch(`/quotations/${id}/notify`),
};

// Vehicles
export const vehiclesAPI = {
    lookup: (vehicleNumber: string) => api.get(`/vehicles/${encodeURIComponent(vehicleNumber)}`),
    list: () => api.get("/vehicles"),
};

// Search
export const searchAPI = {
    search: (q: string, type: "vehicleNumber" | "telephone") =>
        api.get(`/search?q=${encodeURIComponent(q)}&type=${type}`),
};

// Notifications
export const notificationsAPI = {
    list: () => api.get("/notifications"),
    create: (data: object) => api.post("/notifications", data),
    markRead: (id: string) => api.put(`/notifications/${id}/read`),
    delete: (id: string) => api.delete(`/notifications/${id}`),
};

// Employees
export const employeesAPI = {
    list: () => api.get("/employees"),
    create: (data: object) => api.post("/employees", data),
    toggleStatus: (id: string, isActive: boolean) =>
        api.patch(`/employees/${id}/status`, { isActive }),
};

// Analytics
export const analyticsAPI = {
    summary: (range: "daily" | "weekly" | "monthly", date?: string) =>
        api.get(`/analytics/summary?range=${range}${date ? `&date=${date}` : ""}`),
};

// Inventory
export const inventoryAPI = {
    list: () => api.get("/inventory"),
    search: (q: string) => api.get(`/inventory/search?q=${encodeURIComponent(q)}`),
    create: (data: object) => api.post("/inventory", data),
    update: (id: string, data: object) => api.put(`/inventory/${id}`, data),
    delete: (id: string) => api.delete(`/inventory/${id}`),
    ledger: (id: string) => api.get(`/inventory/${id}/ledger`),
};

// Attendance
export const attendanceAPI = {
    // Employee
    today: () => api.get("/attendance/today"),
    my: () => api.get("/attendance/my"),
    checkIn: () => api.post("/attendance/checkin"),
    checkOut: (reason?: string) => api.post("/attendance/checkout", { reason }),
    overtimeStart: (reason: string) => api.post("/attendance/overtime/start", { reason }),
    overtimeEnd: (overtimeId: string) => api.post("/attendance/overtime/end", { overtimeId }),
    applyLeave: (data: { leaveFrom: string; leaveTo: string; reason?: string }) => api.post("/attendance/leave", data),
    confirmLeaveEnd: (leaveId: string) => api.post("/attendance/leave/confirm-end", { leaveId }),
    requestHoliday: (data: { holidayDate: string; description?: string }) => api.post("/attendance/holiday", data),

    // Admin
    adminPending: () => api.get("/attendance/admin/pending"),
    approveRequest: (id: string) => api.put(`/attendance/admin/request/${id}/approve`),
    rejectRequest: (id: string, reason?: string) => api.put(`/attendance/admin/request/${id}/reject`, { reason }),
    approveLeave: (id: string) => api.put(`/attendance/admin/leave/${id}/approve`),
    rejectLeave: (id: string, reason?: string) => api.put(`/attendance/admin/leave/${id}/reject`, { reason }),
    approveOvertime: (id: string) => api.put(`/attendance/admin/overtime/${id}/approve`),
    rejectOvertime: (id: string, reason?: string) => api.put(`/attendance/admin/overtime/${id}/reject`, { reason }),
    approveHoliday: (id: string) => api.put(`/attendance/admin/holiday/${id}/approve`),
    rejectHoliday: (id: string) => api.put(`/attendance/admin/holiday/${id}/reject`),

    // Manager
    overview: (period: "weekly" | "monthly", date?: string) =>
        api.get(`/attendance/manager/overview?period=${period}${date ? `&date=${date}` : ""}`),
    history: (params?: { employeeId?: string; startDate?: string; endDate?: string }) =>
        api.get("/attendance/manager/history", { params }),
    archive: () => api.post("/attendance/manager/archive"),
    managerEmployees: () => api.get("/attendance/manager/employees"),
};
