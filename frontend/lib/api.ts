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

// Quotations
export const quotationsAPI = {
    create: (data: object) => api.post("/quotations", data),
    list: () => api.get("/quotations"),
    get: (id: string) => api.get(`/quotations/${id}`),
    update: (id: string, data: object) => api.put(`/quotations/${id}`, data),
    send: (id: string) => api.put(`/quotations/${id}/send`),
    finalize: (id: string, data: object) => api.put(`/quotations/${id}/finalize`, data),
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
