"use client";
import { useState, useEffect, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { jobsAPI, quotationsAPI, vehiclesAPI, notificationsAPI, employeesAPI, attendanceAPI } from "@/lib/api";
import { formatDate, JOB_TYPE_LABELS } from "@/lib/utils";
import { Eye, ChevronRight, Send, Plus, Edit3, Search, Bell, X, Check, FileText, Clock, Users, UserCheck, UserX, CalendarClock, CheckCircle, XCircle, Umbrella, Star, Calendar, AlertTriangle } from "lucide-react";

type Tab = "requests" | "quotations" | "notifications" | "search" | "employees" | "attendance";

interface Job {
    id: string; jobNumber: number; jobType: string; status: string; notes: string; voiceNoteUrl?: string;
    createdAt: string; vehicle: { vehicleNumber: string; ownerName?: string };
    employee: { name: string }; images: { id: string; url: string; phase: string }[];
    insuranceCompany?: string;
}

interface Quotation {
    id: string; vehicleNumber: string; ownerName?: string; telephone?: string;
    vehicleType?: string; color?: string; status: string; createdAt: string;
    job: Job; items: { id: string; description: string; price: number; laborCost: number; partReplaced?: string }[];
}

interface Notification {
    id: string; message: string; vehicleNumber?: string; quotationId?: string;
    isRead: boolean; createdAt: string; fromRole: string;
}

interface Vehicle {
    vehicleNumber: string; ownerName?: string; address?: string; telephone?: string;
    vehicleType?: string; color?: string;
}

interface SearchResult {
    vehicle: Vehicle;
    jobs: Job[];
}

export default function AdminDashboard() {
    const [tab, setTab] = useState<Tab>("requests");
    const [jobs, setJobs] = useState<Job[]>([]);
    const [quotations, setQuotations] = useState<Quotation[]>([]);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(false);

    // Employees
    const [employees, setEmployees] = useState<any[]>([]);
    const [empLoading, setEmpLoading] = useState(false);
    const [empForm, setEmpForm] = useState({ name: "", email: "", nicNumber: "", address: "", password: "" });
    const [empError, setEmpError] = useState("");
    const [empSubmitting, setEmpSubmitting] = useState(false);

    // Review modal
    const [reviewJob, setReviewJob] = useState<Job | null>(null);

    // Quotation form
    const [showQuotationForm, setShowQuotationForm] = useState(false);
    const [quotationJob, setQuotationJob] = useState<Job | null>(null);
    const [qForm, setQForm] = useState({ vehicleNumber: "", ownerName: "", address: "", telephone: "", vehicleType: "", color: "", insuranceCompany: "", jobDetails: "" });
    const [qItems, setQItems] = useState([{ description: "", partReplaced: "", price: 0, laborCost: 0 }]);
    const [qLoading, setQLoading] = useState(false);

    // Search
    const [searchQ, setSearchQ] = useState("");
    const [searchType, setSearchType] = useState<"vehicleNumber" | "telephone">("vehicleNumber");
    const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
    const [searchError, setSearchError] = useState("");

    // Edit quotation modal
    const [editQuotation, setEditQuotation] = useState<Quotation | null>(null);

    // Notification compose
    const [notifMessage, setNotifMessage] = useState("");
    const [notifVehicle, setNotifVehicle] = useState("");
    const [sendingNotif, setSendingNotif] = useState(false);

    // Attendance
    const [attPending, setAttPending] = useState<{ requests: any[]; leaves: any[]; overtimes: any[]; holidays: any[] } | null>(null);
    const [attLoading, setAttLoading] = useState(false);
    const [attActionLoading, setAttActionLoading] = useState<string | null>(null);

    const fetchJobs = useCallback(async () => {
        const res = await jobsAPI.list();
        setJobs(res.data.filter((j: Job) => ["SUBMITTED", "REVIEWED"].includes(j.status)));
    }, []);

    const fetchQuotations = useCallback(async () => {
        const res = await quotationsAPI.list();
        setQuotations(res.data.filter((q: Quotation) => ["DRAFT", "SENT_TO_MANAGER"].includes(q.status)));
    }, []);

    const fetchNotifications = useCallback(async () => {
        const res = await notificationsAPI.list();
        setNotifications(res.data);
    }, []);

    useEffect(() => {
        setLoading(true);
        Promise.all([fetchJobs(), fetchQuotations(), fetchNotifications()]).finally(() => setLoading(false));
    }, [fetchJobs, fetchQuotations, fetchNotifications]);

    useEffect(() => {
        if (tab === "employees") {
            setEmpLoading(true);
            employeesAPI.list().then(r => setEmployees(r.data)).finally(() => setEmpLoading(false));
        }
        if (tab === "attendance") {
            setAttLoading(true);
            attendanceAPI.adminPending().then(r => setAttPending(r.data)).finally(() => setAttLoading(false));
        }
    }, [tab]);

    const handleAttAction = async (action: () => Promise<unknown>, key: string) => {
        setAttActionLoading(key);
        try {
            await action();
            const r = await attendanceAPI.adminPending();
            setAttPending(r.data);
        } catch (e: any) {
            alert(e?.response?.data?.error || "Action failed");
        } finally { setAttActionLoading(null); }
    };

    const handleCreateEmployee = async (e: React.FormEvent) => {
        e.preventDefault();
        setEmpError("");
        setEmpSubmitting(true);
        try {
            await employeesAPI.create(empForm);
            setEmpForm({ name: "", email: "", nicNumber: "", address: "", password: "" });
            const res = await employeesAPI.list();
            setEmployees(res.data);
        } catch (err: any) {
            setEmpError(err?.response?.data?.error || "Failed to create employee");
        } finally {
            setEmpSubmitting(false);
        }
    };

    const toggleEmployeeStatus = async (id: string, current: boolean) => {
        await employeesAPI.toggleStatus(id, !current);
        setEmployees(prev => prev.map(e => e.id === id ? { ...e, isActive: !current } : e));
    };

    const handleReview = async (job: Job) => {
        await jobsAPI.review(job.id);
        setReviewJob(job);
        fetchJobs();
    };

    const proceedToQuotation = async (job: Job) => {
        setQuotationJob(job);
        const vn = job.vehicle.vehicleNumber;
        setQForm({ vehicleNumber: vn, ownerName: "", address: "", telephone: "", vehicleType: "", color: "", insuranceCompany: job.insuranceCompany || "", jobDetails: job.notes || "" });
        setQItems([{ description: "", partReplaced: "", price: 0, laborCost: 0 }]);
        // Try auto-fill
        try {
            const vRes = await vehiclesAPI.lookup(vn);
            const v = vRes.data;
            setQForm(f => ({ ...f, ownerName: v.ownerName || "", address: v.address || "", telephone: v.telephone || "", vehicleType: v.vehicleType || "", color: v.color || "" }));
        } catch { /* new vehicle */ }
        setReviewJob(null);
        setShowQuotationForm(true);
    };

    const submitQuotation = async () => {
        if (!quotationJob) return;
        setQLoading(true);
        try {
            await quotationsAPI.create({ ...qForm, jobId: quotationJob.id, items: qItems.filter(i => i.description) });
            setShowQuotationForm(false);
            fetchJobs();
            fetchQuotations();
            setTab("quotations");
        } catch {
            alert("Failed to create quotation");
        } finally {
            setQLoading(false);
        }
    };

    const sendToManager = async (qId: string) => {
        await quotationsAPI.send(qId);
        fetchQuotations();
    };

    const handleSearch = async () => {
        if (!searchQ.trim()) return;
        setSearchError("");
        setSearchResult(null);
        try {
            const { searchAPI } = await import("@/lib/api");
            const res = await searchAPI.search(searchQ.trim(), searchType);
            setSearchResult(res.data);
        } catch {
            setSearchError("No records found for this search.");
        }
    };

    const sendCustomerNotif = async () => {
        if (!notifMessage.trim()) return;
        setSendingNotif(true);
        try {
            await notificationsAPI.create({ toRole: "ADMIN", message: notifMessage, vehicleNumber: notifVehicle });
            setNotifMessage("");
            setNotifVehicle("");
            alert("Notification sent!");
        } catch { alert("Failed to send"); }
        finally { setSendingNotif(false); }
    };

    const unreadCount = notifications.filter(n => !n.isRead).length;

    return (
        <DashboardLayout title="Admin Dashboard" subtitle="Manage jobs, quotations, and notifications">

            {/* Tabs */}
            <div className="flex gap-2 mb-6 flex-wrap">
                {([
                    { key: "requests", label: "Employee Requests", icon: <FileText className="w-3.5 h-3.5" />, count: jobs.length },
                    { key: "quotations", label: "Quotations", icon: <Edit3 className="w-3.5 h-3.5" />, count: quotations.length },
                    { key: "notifications", label: "Notifications", icon: <Bell className="w-3.5 h-3.5" />, count: unreadCount },
                    { key: "search", label: "Search Records", icon: <Search className="w-3.5 h-3.5" />, count: undefined as number | undefined },
                    { key: "employees", label: "Employees", icon: <Users className="w-3.5 h-3.5" />, count: undefined as number | undefined },
                    { key: "attendance", label: "Attendance", icon: <CalendarClock className="w-3.5 h-3.5" />, count: attPending ? (attPending.requests.length + attPending.leaves.length + attPending.overtimes.length + attPending.holidays.length) : undefined },
                ] as const).map(t => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key as Tab)}
                        className={`tab-btn flex items-center gap-1.5 ${tab === t.key ? "active" : ""}`}
                    >
                        {t.icon}{t.label}
                        {t.count !== undefined && t.count > 0 && (
                            <span className="ml-1 bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{t.count}</span>
                        )}
                    </button>
                ))}
            </div>

            {/* ── EMPLOYEE REQUESTS ── */}
            {tab === "requests" && (
                <div className="space-y-4 animate-fade-in">
                    {loading && <div className="text-center text-slate-500 py-10">Loading…</div>}
                    {!loading && jobs.length === 0 && (
                        <div className="card text-center py-10">
                            <Clock className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                            <p className="text-slate-500">No pending employee submissions</p>
                        </div>
                    )}
                    {jobs.map(job => (
                        <div key={job.id} className="card glass-hover">
                            <div className="flex items-start justify-between gap-4 flex-wrap">
                                <div className="flex items-start gap-4">
                                    <div className="w-10 h-10 rounded-xl bg-blue-600/20 flex items-center justify-center flex-shrink-0">
                                        <span className="text-blue-400 font-bold text-sm">#{job.jobNumber}</span>
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-semibold text-white">{job.vehicle.vehicleNumber}</span>
                                            <span className={`badge ${job.jobType === "SERVICE" ? "badge-blue" : job.jobType === "REPAIR" ? "badge-yellow" : "badge-red"}`}>
                                                {JOB_TYPE_LABELS[job.jobType]}
                                            </span>
                                            <span className={`badge ${job.status === "SUBMITTED" ? "badge-yellow" : "badge-green"}`}>{job.status}</span>
                                        </div>
                                        <p className="text-sm text-slate-400 mt-1">Employee: {job.employee.name}</p>
                                        <p className="text-sm text-slate-400">{formatDate(job.createdAt)}</p>
                                        {job.notes && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{job.notes}</p>}
                                        <p className="text-xs text-slate-600 mt-1">{job.images.length} photo{job.images.length !== 1 ? "s" : ""}</p>
                                    </div>
                                </div>
                                <div className="flex gap-2 ml-auto">
                                    <button onClick={() => handleReview(job)} className="btn-secondary text-xs">
                                        <Eye className="w-3.5 h-3.5 inline mr-1" />Review
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── QUOTATIONS ── */}
            {tab === "quotations" && (
                <div className="space-y-4 animate-fade-in">
                    {quotations.length === 0 && <div className="card text-center py-10 text-slate-500">No quotations created yet</div>}
                    {quotations.map(q => (
                        <div key={q.id} className="card glass-hover">
                            <div className="flex items-start justify-between gap-4 flex-wrap">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-semibold text-white">{q.vehicleNumber}</span>
                                        <span className={`badge ${q.status === "DRAFT" ? "badge-yellow" : "badge-green"}`}>{q.status}</span>
                                    </div>
                                    <p className="text-sm text-slate-400">{q.ownerName || "—"} · {q.telephone || "—"}</p>
                                    <p className="text-sm text-slate-400">{q.vehicleType} · {q.color}</p>
                                    <p className="text-xs text-slate-600 mt-1">{formatDate(q.createdAt)}</p>
                                    <p className="text-xs text-slate-500 mt-1">{q.items.length} line items</p>
                                </div>
                                <div className="flex gap-2 ml-auto flex-wrap">
                                    <button onClick={() => setEditQuotation(q)} className="btn-secondary text-xs">
                                        <Edit3 className="w-3.5 h-3.5 inline mr-1" />Edit
                                    </button>
                                    {q.status === "DRAFT" && (
                                        <button onClick={() => sendToManager(q.id)} className="btn-primary text-xs">
                                            <Send className="w-3.5 h-3.5 inline mr-1" />Send to Manager
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── NOTIFICATIONS ── */}
            {tab === "notifications" && (
                <div className="space-y-6 animate-fade-in">
                    {/* Incoming manager notifications */}
                    <div>
                        <h3 className="text-sm font-semibold text-slate-400 mb-3">Incoming Notifications</h3>
                        {notifications.length === 0 && <div className="card text-center py-8 text-slate-500 text-sm">No notifications</div>}
                        {notifications.map(n => (
                            <div key={n.id} className={`card mb-3 ${!n.isRead ? "border-blue-500/30 bg-blue-500/5" : ""}`}>
                                <div className="flex items-start gap-3">
                                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${!n.isRead ? "bg-blue-400" : "bg-white/20"}`} />
                                    <div className="flex-1">
                                        <p className="text-sm text-slate-200">{n.message}</p>
                                        {n.vehicleNumber && <p className="text-xs text-slate-500 mt-1">Vehicle: {n.vehicleNumber}</p>}
                                        <p className="text-xs text-slate-600 mt-1">{formatDate(n.createdAt)}</p>
                                    </div>
                                    {!n.isRead && (
                                        <button onClick={async () => { await notificationsAPI.markRead(n.id); fetchNotifications(); }} className="text-xs text-blue-400 hover:text-blue-300">
                                            <Check className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Compose message to customer */}
                    <div className="card border-emerald-500/20">
                        <h3 className="text-sm font-semibold text-emerald-300 mb-4 flex items-center gap-2">
                            <Send className="w-4 h-4" />Send Message to Customer
                        </h3>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Vehicle Number</label>
                                <input value={notifVehicle} onChange={e => setNotifVehicle(e.target.value.toUpperCase())} placeholder="CAA-1234" className="input-field font-mono text-sm" />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Message</label>
                                <textarea
                                    value={notifMessage}
                                    onChange={e => setNotifMessage(e.target.value)}
                                    rows={4}
                                    placeholder="Your vehicle is ready for pickup. We have completed the following services:&#10;- Engine oil replacement&#10;- Brake pad inspection&#10;Please visit us at your earliest convenience."
                                    className="input-field resize-none text-sm"
                                />
                            </div>
                            <button onClick={sendCustomerNotif} disabled={sendingNotif || !notifMessage.trim()} className="btn-success text-sm">
                                <Send className="w-3.5 h-3.5 inline mr-1.5" />Send to Customer
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── EMPLOYEE MANAGEMENT ── */}
            {tab === "employees" && (
                <div className="space-y-6 animate-fade-in">
                    {/* Create employee form */}
                    <div className="card border-blue-500/20">
                        <h3 className="text-sm font-semibold text-blue-300 mb-4 flex items-center gap-2">
                            <Plus className="w-4 h-4" />Create New Employee Account
                        </h3>
                        <form onSubmit={handleCreateEmployee} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Full Name *</label>
                                <input value={empForm.name} onChange={e => setEmpForm(f => ({ ...f, name: e.target.value }))} className="input-field text-sm" placeholder="John Silva" required />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Email Address *</label>
                                <input type="email" value={empForm.email} onChange={e => setEmpForm(f => ({ ...f, email: e.target.value }))} className="input-field text-sm" placeholder="john@example.com" required />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">NIC Number *</label>
                                <input value={empForm.nicNumber} onChange={e => setEmpForm(f => ({ ...f, nicNumber: e.target.value }))} className="input-field text-sm font-mono" placeholder="199012345678" required />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Temporary Password *</label>
                                <input type="text" value={empForm.password} onChange={e => setEmpForm(f => ({ ...f, password: e.target.value }))} className="input-field text-sm font-mono" placeholder="Jayakody@2026" required />
                            </div>
                            <div className="sm:col-span-2">
                                <label className="block text-xs text-slate-400 mb-1">Residential Address *</label>
                                <input value={empForm.address} onChange={e => setEmpForm(f => ({ ...f, address: e.target.value }))} className="input-field text-sm" placeholder="No. 25, Main Street, Colombo" required />
                            </div>
                            {empError && <div className="sm:col-span-2 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">{empError}</div>}
                            <div className="sm:col-span-2 flex justify-end">
                                <button type="submit" className="btn-primary" disabled={empSubmitting}>
                                    <Plus className="w-4 h-4 inline mr-1" />
                                    {empSubmitting ? "Creating…" : "Create Employee Account"}
                                </button>
                            </div>
                        </form>
                    </div>

                    {/* Employee list */}
                    <div>
                        <h3 className="text-sm font-semibold text-slate-300 mb-3">All Employees ({employees.length})</h3>
                        {empLoading && <div className="text-center py-8 text-slate-500">Loading…</div>}
                        {!empLoading && employees.length === 0 && (
                            <div className="card text-center py-10 text-slate-500">No employee accounts yet.</div>
                        )}
                        <div className="space-y-3">
                            {employees.map(emp => (
                                <div key={emp.id} className="card flex items-center justify-between gap-4 flex-wrap hover:bg-white/5 transition-colors">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center flex-shrink-0">
                                            <span className="text-blue-400 font-bold text-sm">{emp.name[0]}</span>
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-white text-sm">{emp.name}</span>
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${emp.isActive ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"}`}>
                                                    {emp.isActive ? "Active" : "Inactive"}
                                                </span>
                                                {emp.isFirstLogin && <span className="px-2 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300">First Login Pending</span>}
                                            </div>
                                            <p className="text-xs text-slate-500">{emp.email}</p>
                                            <p className="text-xs text-slate-600">{emp.nicNumber || "No NIC"} · {emp.address ? emp.address.slice(0, 40) : "No Address"}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 ml-auto">
                                        <span className="text-xs text-slate-500">{emp._count?.jobs || 0} jobs</span>
                                        <button
                                            onClick={() => toggleEmployeeStatus(emp.id, emp.isActive)}
                                            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${emp.isActive ? "border-red-500/30 text-red-400 hover:bg-red-500/10" : "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"}`}
                                        >
                                            {emp.isActive ? <><UserX className="w-3.5 h-3.5" />Deactivate</> : <><UserCheck className="w-3.5 h-3.5" />Activate</>}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ── SEARCH RECORDS ── */}
            {tab === "search" && (
                <div className="space-y-6 animate-fade-in">
                    <div className="card">
                        <h3 className="text-sm font-semibold mb-4">Search Vehicle Records</h3>
                        <div className="flex gap-3 flex-wrap items-end">
                            <div className="flex gap-2">
                                <button onClick={() => setSearchType("vehicleNumber")} className={`tab-btn text-xs ${searchType === "vehicleNumber" ? "active" : ""}`}>Vehicle No.</button>
                                <button onClick={() => setSearchType("telephone")} className={`tab-btn text-xs ${searchType === "telephone" ? "active" : ""}`}>Telephone</button>
                            </div>
                            <input value={searchQ} onChange={e => setSearchQ(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()} placeholder={searchType === "vehicleNumber" ? "e.g. CAA-1234" : "e.g. 0771234567"} className="input-field flex-1 min-w-48" />
                            <button onClick={handleSearch} className="btn-primary text-sm">
                                <Search className="w-4 h-4 inline mr-1" />Search
                            </button>
                        </div>
                    </div>

                    {searchError && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">{searchError}</div>}

                    {searchResult && (
                        <div className="space-y-4 animate-fade-in">
                            {/* Vehicle info */}
                            <div className="card border-blue-500/20">
                                <h4 className="font-semibold text-blue-300 mb-3">Vehicle Details</h4>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                                    {[
                                        { label: "Reg. No.", value: searchResult.vehicle.vehicleNumber },
                                        { label: "Owner", value: searchResult.vehicle.ownerName },
                                        { label: "Telephone", value: searchResult.vehicle.telephone },
                                        { label: "Type", value: searchResult.vehicle.vehicleType },
                                        { label: "Color", value: searchResult.vehicle.color },
                                        { label: "Address", value: searchResult.vehicle.address },
                                    ].map(({ label, value }) => (
                                        <div key={label}>
                                            <p className="text-xs text-slate-500">{label}</p>
                                            <p className="text-slate-200">{value || "—"}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            {/* Job history */}
                            <h4 className="text-sm font-semibold text-slate-400">Service History ({searchResult.jobs.length} records)</h4>
                            {searchResult.jobs.map(job => (
                                <div key={job.id} className="card">
                                    <div className="flex items-start justify-between gap-2 flex-wrap">
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="badge badge-blue">#{job.jobNumber}</span>
                                                <span className={`badge ${job.jobType === "SERVICE" ? "badge-blue" : job.jobType === "REPAIR" ? "badge-yellow" : "badge-red"}`}>
                                                    {JOB_TYPE_LABELS[job.jobType]}
                                                </span>
                                                <span className="badge badge-green">{job.status}</span>
                                            </div>
                                            <p className="text-xs text-slate-400 mt-1">{formatDate(job.createdAt)}</p>
                                            {job.notes && <p className="text-sm text-slate-300 mt-2">{job.notes}</p>}
                                        </div>
                                        <span className="text-xs text-slate-500">{job.images.length} photo{job.images.length !== 1 ? "s" : ""}</span>
                                    </div>
                                    {job.images.length > 0 && (
                                        <div className="grid grid-cols-4 gap-2 mt-3">
                                            {job.images.slice(0, 8).map(img => (
                                                <img key={img.id} src={`http://localhost:5001${img.url}`} alt="" className="rounded-lg aspect-square object-cover" />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ── ATTENDANCE APPROVALS ── */}
            {tab === "attendance" && (
                <div className="space-y-6 animate-fade-in">
                    {attLoading && <div className="text-center py-10 text-slate-500">Loading…</div>}

                    {attPending && (attPending.requests.length + attPending.leaves.length + attPending.overtimes.length + attPending.holidays.length) === 0 && (
                        <div className="card text-center py-12">
                            <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
                            <p className="text-slate-400">No pending attendance approvals</p>
                        </div>
                    )}

                    {/* Check-in / Check-out / Early Checkout / Overtime requests */}
                    {(attPending?.requests.length ?? 0) > 0 && (
                        <div>
                            <h3 className="text-sm font-semibold text-slate-400 mb-3 flex items-center gap-2">
                                <CalendarClock className="w-4 h-4" />Attendance Requests ({attPending!.requests.length})
                            </h3>
                            <div className="space-y-3">
                                {attPending!.requests.map((r: any) => (
                                    <div key={r.id} className={`card flex items-start justify-between gap-4 flex-wrap ${r.type === "EARLY_CHECKOUT" ? "border-amber-500/30" : ""}`}>
                                        <div>
                                            <div className="flex items-center gap-2 flex-wrap mb-1">
                                                <span className="font-medium text-white text-sm">{r.employee.name}</span>
                                                <span className={`text-xs px-2 py-0.5 rounded font-medium ${r.type === "CHECKIN" ? "bg-emerald-500/20 text-emerald-300" : r.type === "CHECKOUT" ? "bg-blue-500/20 text-blue-300" : r.type === "EARLY_CHECKOUT" ? "bg-amber-500/20 text-amber-300" : r.type === "OVERTIME_START" ? "bg-purple-500/20 text-purple-300" : r.type === "OVERTIME_END" ? "bg-indigo-500/20 text-indigo-300" : "bg-slate-500/20 text-slate-300"}`}>
                                                    {r.type.replace(/_/g, " ")}
                                                </span>
                                                {r.type === "EARLY_CHECKOUT" && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                                            </div>
                                            <p className="text-xs text-slate-500">Requested: {new Date(r.requestedTime).toLocaleString()}</p>
                                            {r.reason && <p className="text-xs text-slate-400 mt-1">Reason: {r.reason}</p>}
                                        </div>
                                        <div className="flex gap-2 ml-auto">
                                            <button
                                                onClick={() => handleAttAction(() => attendanceAPI.approveRequest(r.id), `req-approve-${r.id}`)}
                                                disabled={attActionLoading === `req-approve-${r.id}`}
                                                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30 transition-colors"
                                            >
                                                <CheckCircle className="w-3.5 h-3.5" />{attActionLoading === `req-approve-${r.id}` ? "…" : "Approve"}
                                            </button>
                                            <button
                                                onClick={() => handleAttAction(() => attendanceAPI.rejectRequest(r.id), `req-reject-${r.id}`)}
                                                disabled={attActionLoading === `req-reject-${r.id}`}
                                                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 hover:bg-red-500/30 transition-colors"
                                            >
                                                <XCircle className="w-3.5 h-3.5" />{attActionLoading === `req-reject-${r.id}` ? "…" : "Reject"}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Leave requests */}
                    {(attPending?.leaves.length ?? 0) > 0 && (
                        <div>
                            <h3 className="text-sm font-semibold text-slate-400 mb-3 flex items-center gap-2">
                                <Umbrella className="w-4 h-4" />Leave Requests ({attPending!.leaves.length})
                            </h3>
                            <div className="space-y-3">
                                {attPending!.leaves.map((l: any) => (
                                    <div key={l.id} className="card flex items-start justify-between gap-4 flex-wrap">
                                        <div>
                                            <p className="font-medium text-white text-sm mb-1">{l.employee.name}</p>
                                            <p className="text-xs text-slate-400">From: <span className="text-slate-200">{new Date(l.leaveFrom).toLocaleString()}</span></p>
                                            <p className="text-xs text-slate-400">To: <span className="text-slate-200">{new Date(l.leaveTo).toLocaleString()}</span></p>
                                            {l.reason && <p className="text-xs text-slate-400 mt-1">Reason: {l.reason}</p>}
                                        </div>
                                        <div className="flex gap-2 ml-auto">
                                            <button
                                                onClick={() => handleAttAction(() => attendanceAPI.approveLeave(l.id), `leave-approve-${l.id}`)}
                                                disabled={attActionLoading === `leave-approve-${l.id}`}
                                                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30 transition-colors"
                                            >
                                                <CheckCircle className="w-3.5 h-3.5" />{attActionLoading === `leave-approve-${l.id}` ? "…" : "Approve"}
                                            </button>
                                            <button
                                                onClick={() => handleAttAction(() => attendanceAPI.rejectLeave(l.id), `leave-reject-${l.id}`)}
                                                disabled={attActionLoading === `leave-reject-${l.id}`}
                                                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 hover:bg-red-500/30 transition-colors"
                                            >
                                                <XCircle className="w-3.5 h-3.5" />{attActionLoading === `leave-reject-${l.id}` ? "…" : "Reject"}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Overtime requests */}
                    {(attPending?.overtimes.length ?? 0) > 0 && (
                        <div>
                            <h3 className="text-sm font-semibold text-slate-400 mb-3 flex items-center gap-2">
                                <Star className="w-4 h-4" />Overtime Requests ({attPending!.overtimes.length})
                            </h3>
                            <div className="space-y-3">
                                {attPending!.overtimes.map((o: any) => (
                                    <div key={o.id} className="card flex items-start justify-between gap-4 flex-wrap">
                                        <div>
                                            <p className="font-medium text-white text-sm mb-1">{o.employee.name}</p>
                                            <p className="text-xs text-slate-400">Started: <span className="text-slate-200">{new Date(o.overtimeStart).toLocaleString()}</span></p>
                                            {o.reason && <p className="text-xs text-slate-400 mt-1">Task: {o.reason}</p>}
                                        </div>
                                        <div className="flex gap-2 ml-auto">
                                            <button
                                                onClick={() => handleAttAction(() => attendanceAPI.approveOvertime(o.id), `ot-approve-${o.id}`)}
                                                disabled={attActionLoading === `ot-approve-${o.id}`}
                                                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30 transition-colors"
                                            >
                                                <CheckCircle className="w-3.5 h-3.5" />{attActionLoading === `ot-approve-${o.id}` ? "…" : "Approve"}
                                            </button>
                                            <button
                                                onClick={() => handleAttAction(() => attendanceAPI.rejectOvertime(o.id), `ot-reject-${o.id}`)}
                                                disabled={attActionLoading === `ot-reject-${o.id}`}
                                                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 hover:bg-red-500/30 transition-colors"
                                            >
                                                <XCircle className="w-3.5 h-3.5" />{attActionLoading === `ot-reject-${o.id}` ? "…" : "Reject"}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Holiday requests */}
                    {(attPending?.holidays.length ?? 0) > 0 && (
                        <div>
                            <h3 className="text-sm font-semibold text-slate-400 mb-3 flex items-center gap-2">
                                <Calendar className="w-4 h-4" />Holiday Requests ({attPending!.holidays.length})
                            </h3>
                            <div className="space-y-3">
                                {attPending!.holidays.map((h: any) => (
                                    <div key={h.id} className="card flex items-start justify-between gap-4 flex-wrap">
                                        <div>
                                            <p className="font-medium text-white text-sm mb-1">{h.employee.name}</p>
                                            <p className="text-xs text-slate-400">Date: <span className="text-slate-200">{new Date(h.holidayDate).toLocaleDateString()}</span></p>
                                            {h.description && <p className="text-xs text-slate-400 mt-1">Reason: {h.description}</p>}
                                            <p className="text-xs text-amber-400 mt-1">Approving will temporarily deactivate the employee account for this period.</p>
                                        </div>
                                        <div className="flex gap-2 ml-auto">
                                            <button
                                                onClick={() => handleAttAction(() => attendanceAPI.approveHoliday(h.id), `hol-approve-${h.id}`)}
                                                disabled={attActionLoading === `hol-approve-${h.id}`}
                                                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30 transition-colors"
                                            >
                                                <CheckCircle className="w-3.5 h-3.5" />{attActionLoading === `hol-approve-${h.id}` ? "…" : "Approve"}
                                            </button>
                                            <button
                                                onClick={() => handleAttAction(() => attendanceAPI.rejectHoliday(h.id), `hol-reject-${h.id}`)}
                                                disabled={attActionLoading === `hol-reject-${h.id}`}
                                                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 hover:bg-red-500/30 transition-colors"
                                            >
                                                <XCircle className="w-3.5 h-3.5" />{attActionLoading === `hol-reject-${h.id}` ? "…" : "Reject"}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ══ REVIEW MODAL ══ */}
            {reviewJob && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="card max-w-2xl w-full max-h-[90vh] overflow-y-auto animate-fade-in">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-semibold text-lg">Job #{reviewJob.jobNumber} — Review</h3>
                            <button onClick={() => setReviewJob(null)} className="text-slate-500 hover:text-slate-200"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm mb-4">
                            <div><p className="text-slate-500 text-xs">Vehicle</p><p className="text-white font-mono">{reviewJob.vehicle.vehicleNumber}</p></div>
                            <div><p className="text-slate-500 text-xs">Job Type</p><p className="text-white">{JOB_TYPE_LABELS[reviewJob.jobType]}</p></div>
                            <div><p className="text-slate-500 text-xs">Employee</p><p className="text-white">{reviewJob.employee.name}</p></div>
                            <div><p className="text-slate-500 text-xs">Date</p><p className="text-white">{formatDate(reviewJob.createdAt)}</p></div>
                        </div>
                        {(reviewJob.notes || reviewJob.voiceNoteUrl) && (
                            <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-4">
                                {reviewJob.notes && (
                                    <>
                                        <p className="text-xs text-slate-500 mb-1">Notes / Work Done</p>
                                        <p className="text-sm text-slate-200 whitespace-pre-wrap">{reviewJob.notes}</p>
                                    </>
                                )}
                                {reviewJob.voiceNoteUrl && (
                                    <div className="mt-3 pt-3 border-t border-white/10">
                                        <p className="text-xs text-slate-500 mb-2">Attached Voice Note</p>
                                        <audio className="w-full h-8" controls src={`${process.env.NEXT_PUBLIC_API_URL?.replace('/api', '')}${reviewJob.voiceNoteUrl}`} />
                                    </div>
                                )}
                            </div>
                        )}
                        {reviewJob.insuranceCompany && (
                            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-4">
                                <p className="text-xs text-slate-500 mb-1">Insurance Company</p>
                                <p className="text-sm text-red-300">{reviewJob.insuranceCompany}</p>
                            </div>
                        )}
                        {/* Images by phase */}
                        {(["BEFORE", "AFTER", "PART"] as const).map(phase => {
                            const imgs = reviewJob.images.filter(i => i.phase === phase);
                            if (!imgs.length) return null;
                            return (
                                <div key={phase} className="mb-4">
                                    <p className="text-xs text-slate-500 mb-2">{phase === "BEFORE" ? "Before Photos" : phase === "AFTER" ? "After Photos" : "Replaced Parts"} ({imgs.length})</p>
                                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                        {imgs.map(img => (
                                            <a key={img.id} href={`http://localhost:5001${img.url}`} target="_blank" rel="noopener noreferrer">
                                                <img src={`http://localhost:5001${img.url}`} alt="" className="rounded-lg aspect-square object-cover hover:scale-105 transition-transform cursor-zoom-in" />
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                        <div className="flex gap-3 mt-6">
                            <button onClick={() => setReviewJob(null)} className="btn-secondary flex-1">← Back</button>
                            <button onClick={() => proceedToQuotation(reviewJob)} className="btn-primary flex-1">
                                <ChevronRight className="w-4 h-4 inline mr-1" />Proceed to Quotation
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ══ QUOTATION FORM MODAL ══ */}
            {showQuotationForm && quotationJob && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="card max-w-2xl w-full max-h-[90vh] overflow-y-auto animate-fade-in">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="font-semibold text-lg">Create Quotation</h3>
                                <p className="text-sm text-slate-500">Job #{quotationJob.jobNumber} · {quotationJob.vehicle.vehicleNumber}</p>
                            </div>
                            <button onClick={() => setShowQuotationForm(false)} className="text-slate-500 hover:text-slate-200"><X className="w-5 h-5" /></button>
                        </div>

                        {/* Employee info read-only */}
                        {(quotationJob.notes || quotationJob.voiceNoteUrl) && (
                            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 text-sm mt-3 mb-4">
                                <p className="text-xs text-amber-400 font-medium mb-1">Employee Notes (Read Only)</p>
                                {quotationJob.notes && <p className="text-sm text-slate-300 whitespace-pre-wrap">{quotationJob.notes}</p>}
                                {!quotationJob.notes && !quotationJob.voiceNoteUrl && <p className="text-sm text-slate-500">No notes provided</p>}
                                {quotationJob.voiceNoteUrl && (
                                    <div className="mt-3 pt-3 border-t border-amber-500/10">
                                        <p className="text-xs text-amber-400 font-medium mb-2">Voice Note</p>
                                        <audio className="w-full h-8" controls src={`${process.env.NEXT_PUBLIC_API_URL?.replace('/api', '')}${quotationJob.voiceNoteUrl}`} />
                                    </div>
                                )}
                            </div>
                        )}
                        <p className="text-xs text-slate-500 mt-2">Job Type: {JOB_TYPE_LABELS[quotationJob.jobType]}</p>

                        {/* Vehicle details */}
                        <div className="grid grid-cols-2 gap-3 mb-4">
                            {[{ k: "vehicleNumber", label: "Vehicle No. *" }, { k: "ownerName", label: "Owner Name" }, { k: "address", label: "Address" }, { k: "telephone", label: "Telephone" }, { k: "vehicleType", label: "Vehicle Type" }, { k: "color", label: "Color" }].map(({ k, label }) => (
                                <div key={k} className={k === "address" ? "col-span-2" : ""}>
                                    <label className="block text-xs text-slate-400 mb-1">{label}</label>
                                    <input
                                        value={qForm[k as keyof typeof qForm]}
                                        onChange={e => setQForm(f => ({ ...f, [k]: e.target.value }))}
                                        className="input-field text-sm"
                                        readOnly={k === "vehicleNumber"}
                                    />
                                </div>
                            ))}
                            {quotationJob.jobType === "ACCIDENT_RECOVERY" && (
                                <div className="col-span-2">
                                    <label className="block text-xs text-slate-400 mb-1">Insurance Company</label>
                                    <input value={qForm.insuranceCompany} onChange={e => setQForm(f => ({ ...f, insuranceCompany: e.target.value }))} className="input-field text-sm" />
                                </div>
                            )}
                        </div>

                        {/* Job details */}
                        <div className="mb-4">
                            <label className="block text-xs text-slate-400 mb-1">Job Details (Exact description of work done)</label>
                            <textarea value={qForm.jobDetails} onChange={e => setQForm(f => ({ ...f, jobDetails: e.target.value }))} rows={4} className="input-field text-sm resize-none" placeholder="Describe all work done accurately..." />
                        </div>

                        {/* Line items */}
                        <div className="mb-4">
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-xs text-slate-400 font-medium">Quotation Items</label>
                                <button onClick={() => setQItems(i => [...i, { description: "", partReplaced: "", price: 0, laborCost: 0 }])} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"><Plus className="w-3 h-3" />Add Item</button>
                            </div>
                            <div className="space-y-2">
                                {qItems.map((item, i) => (
                                    <div key={i} className="grid grid-cols-12 gap-2">
                                        <input value={item.description} onChange={e => { const n = [...qItems]; n[i].description = e.target.value; setQItems(n); }} placeholder="Description" className="input-field text-xs col-span-5" />
                                        <input value={item.partReplaced} onChange={e => { const n = [...qItems]; n[i].partReplaced = e.target.value; setQItems(n); }} placeholder="Part replaced" className="input-field text-xs col-span-3" />
                                        <input type="number" value={item.price} onChange={e => { const n = [...qItems]; n[i].price = +e.target.value; setQItems(n); }} placeholder="Price" className="input-field text-xs col-span-2" />
                                        <button onClick={() => setQItems(items => items.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-400 col-span-1 flex items-center justify-center"><X className="w-3.5 h-3.5" /></button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button onClick={() => setShowQuotationForm(false)} className="btn-secondary flex-1">Cancel</button>
                            <button onClick={submitQuotation} disabled={qLoading} className="btn-primary flex-1">
                                {qLoading ? "Creating…" : "Add Quotation"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ══ EDIT QUOTATION MODAL ══ */}
            {editQuotation && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="card max-w-xl w-full max-h-[90vh] overflow-y-auto animate-fade-in">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-semibold">Edit Quotation — {editQuotation.vehicleNumber}</h3>
                            <button onClick={() => setEditQuotation(null)}><X className="w-5 h-5 text-slate-500" /></button>
                        </div>
                        <p className="text-sm text-slate-400 mb-4">You can update customer details and line items. Employee notes cannot be changed.</p>
                        <div className="grid grid-cols-2 gap-3 mb-4">
                            {[["ownerName", "Owner Name"], ["telephone", "Telephone"], ["vehicleType", "Vehicle Type"], ["color", "Color"]].map(([k, label]) => (
                                <div key={k}>
                                    <label className="block text-xs text-slate-400 mb-1">{label}</label>
                                    <input
                                        defaultValue={(editQuotation as unknown as Record<string, unknown>)[k] as string || ""}
                                        onBlur={e => { (editQuotation as unknown as Record<string, unknown>)[k] = e.target.value; }}
                                        className="input-field text-sm"
                                    />
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-3">
                            <button onClick={() => setEditQuotation(null)} className="btn-secondary flex-1">Close</button>
                            {editQuotation.status === "DRAFT" && (
                                <button onClick={async () => { await sendToManager(editQuotation.id); setEditQuotation(null); fetchQuotations(); }} className="btn-primary flex-1">
                                    <Send className="w-3.5 h-3.5 inline mr-1" />Send to Manager
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </DashboardLayout>
    );
}
