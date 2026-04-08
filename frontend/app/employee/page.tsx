"use client";
import { useState, useEffect, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import ImageUploader from "@/components/ImageUploader";
import { jobsAPI, voiceAPI, attendanceAPI } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Plus, Send, CheckCircle, Wrench, Car, Zap, AlertTriangle, FileText, Clock, ChevronRight, Eye, X, CalendarClock, LogIn, LogOut, Coffee, Umbrella, Star, AlertCircle, Calendar } from "lucide-react";

type JobType = "SERVICE" | "REPAIR" | "ACCIDENT_RECOVERY";
type Step = "select_type" | "before_images" | "after_images" | "notes" | "done";

interface CreatedJob {
    id: string;
    jobNumber: number;
}

const JOB_TYPES: { value: JobType; label: string; desc: string; icon: React.ReactNode; color: string }[] = [
    { value: "SERVICE", label: "Monthly Service", desc: "Routine maintenance and oil change", icon: <Wrench className="w-6 h-6" />, color: "blue" },
    { value: "REPAIR", label: "Repair", desc: "Mechanical or electrical repair work", icon: <Zap className="w-6 h-6" />, color: "amber" },
    { value: "ACCIDENT_RECOVERY", label: "Accident Recovery", desc: "Body work and accident damage repair", icon: <AlertTriangle className="w-6 h-6" />, color: "red" },
];

type Tab = "create" | "history" | "attendance";

interface AttendanceToday {
    attendance: { id: string; checkInTime: string | null; checkOutTime: string | null; status: string } | null;
    pendingRequests: { id: string; type: string; requestedTime: string; status: string }[];
    activeLeave: { id: string; leaveFrom: string; leaveTo: string; reason: string; leaveEndConfirmed: boolean } | null;
    activeOvertime: { id: string; overtimeStart: string; status: string } | null;
    holiday: { id: string; holidayDate: string; description: string } | null;
}

interface MyAttendance {
    requests: any[];
    leaves: any[];
    overtimes: any[];
    holidays: any[];
    attendance: any[];
}

export default function EmployeeDashboard() {
    const { user } = useAuth();
    const [step, setStep] = useState<Step>("select_type");
    const [jobType, setJobType] = useState<JobType>("SERVICE");
    const [vehicleNumber, setVehicleNumber] = useState("");
    const [job, setJob] = useState<CreatedJob | null>(null);
    const [notes, setNotes] = useState("");
    const [insuranceCompany, setInsuranceCompany] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [beforeImages, setBeforeImages] = useState<unknown[]>([]);
    const [afterImages, setAfterImages] = useState<unknown[]>([]);
    const [tab, setTab] = useState<Tab>("create");
    const [history, setHistory] = useState<any[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [viewingJob, setViewingJob] = useState<any | null>(null);

    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);

    // ── Attendance state ──────────────────────────────────────────────────────
    const [todayStatus, setTodayStatus] = useState<AttendanceToday | null>(null);
    const [myAttendance, setMyAttendance] = useState<MyAttendance | null>(null);
    const [attLoading, setAttLoading] = useState(false);
    const [attActionLoading, setAttActionLoading] = useState(false);
    const [attError, setAttError] = useState("");
    const [showCheckInModal, setShowCheckInModal] = useState(false);
    const [checkoutReason, setCheckoutReason] = useState("");
    const [showCheckoutModal, setShowCheckoutModal] = useState(false);
    const [showOvertimeModal, setShowOvertimeModal] = useState(false);
    const [overtimeReason, setOvertimeReason] = useState("");
    const [showLeaveModal, setShowLeaveModal] = useState(false);
    const [leaveForm, setLeaveForm] = useState({ leaveFrom: "", leaveTo: "", reason: "", leaveFromDate: "", leaveFromTime: "09:00", leaveToDate: "", leaveToTime: "18:00" });
    const [showHolidayModal, setShowHolidayModal] = useState(false);
    const [holidayForm, setHolidayForm] = useState({ holidayDate: "", description: "" });
    const [showLeaveEndModal, setShowLeaveEndModal] = useState(false);

    const fetchTodayStatus = useCallback(async () => {
        try {
            const res = await attendanceAPI.today();
            setTodayStatus(res.data);
            // Show check-in modal if no attendance & no pending checkin & no active leave/holiday
            const d = res.data as AttendanceToday;
            const hasPendingCheckin = d.pendingRequests.some((r) => r.type === "CHECKIN");
            if (!d.attendance && !hasPendingCheckin && !d.activeLeave && !d.holiday) {
                setShowCheckInModal(true);
            }
            // Show leave-end confirmation if leave ended
            if (d.activeLeave && !d.activeLeave.leaveEndConfirmed) {
                const leaveEnd = new Date(d.activeLeave.leaveTo);
                if (new Date() > leaveEnd) setShowLeaveEndModal(true);
            }
        } catch { /* not logged in yet */ }
    }, []);

    const fetchMyAttendance = useCallback(async () => {
        try {
            const res = await attendanceAPI.my();
            setMyAttendance(res.data);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        fetchTodayStatus();
    }, [fetchTodayStatus]);

    useEffect(() => {
        if (tab === "attendance") {
            setAttLoading(true);
            Promise.all([fetchTodayStatus(), fetchMyAttendance()]).finally(() => setAttLoading(false));
        }
    }, [tab, fetchTodayStatus, fetchMyAttendance]);

    const handleCheckIn = async () => {
        setAttActionLoading(true);
        setAttError("");
        try {
            await attendanceAPI.checkIn();
            setShowCheckInModal(false);
            await fetchTodayStatus();
        } catch (e: any) {
            setAttError(e?.response?.data?.error || "Failed to send check-in request");
        } finally { setAttActionLoading(false); }
    };

    const handleCheckOut = async () => {
        setAttActionLoading(true);
        setAttError("");
        try {
            await attendanceAPI.checkOut(checkoutReason || undefined);
            setShowCheckoutModal(false);
            setCheckoutReason("");
            await fetchTodayStatus();
        } catch (e: any) {
            setAttError(e?.response?.data?.error || "Failed to send checkout request");
        } finally { setAttActionLoading(false); }
    };

    const handleOvertimeStart = async () => {
        setAttActionLoading(true);
        setAttError("");
        try {
            await attendanceAPI.overtimeStart(overtimeReason);
            setShowOvertimeModal(false);
            setOvertimeReason("");
            await fetchTodayStatus();
        } catch (e: any) {
            setAttError(e?.response?.data?.error || "Failed to request overtime");
        } finally { setAttActionLoading(false); }
    };

    const handleOvertimeEnd = async (overtimeId: string) => {
        setAttActionLoading(true);
        try {
            await attendanceAPI.overtimeEnd(overtimeId);
            await fetchTodayStatus();
        } catch (e: any) {
            setAttError(e?.response?.data?.error || "Failed to confirm overtime end");
        } finally { setAttActionLoading(false); }
    };

    const handleApplyLeave = async () => {
        setAttActionLoading(true);
        setAttError("");

        if (!leaveForm.leaveFromDate || !leaveForm.leaveToDate) {
            setAttError(`Dates missing in state! fromDate="${leaveForm.leaveFromDate}" toDate="${leaveForm.leaveToDate}"`);
            setAttActionLoading(false);
            return;
        }

        // Validate text input formats
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        const timeRegex = /^\d{2}:\d{2}$/;
        if (!dateRegex.test(leaveForm.leaveFromDate) || !dateRegex.test(leaveForm.leaveToDate)) {
            setAttError("Dates must be in YYYY-MM-DD format (Example: 2026-10-15)");
            setAttActionLoading(false);
            return;
        }
        const setFromTime = leaveForm.leaveFromTime || "09:00";
        const setToTime = leaveForm.leaveToTime || "18:00";
        if (!timeRegex.test(setFromTime) || !timeRegex.test(setToTime)) {
            setAttError("Times must be in HH:MM format in 24-hour time (Example: 09:00 or 14:30)");
            setAttActionLoading(false);
            return;
        }

        try {
            // Combine separate date+time fields into ISO strings
            const leaveFrom = `${leaveForm.leaveFromDate}T${setFromTime}:00`;
            const leaveTo = `${leaveForm.leaveToDate}T${setToTime}:00`;
            await attendanceAPI.applyLeave({ leaveFrom, leaveTo, reason: leaveForm.reason });
            setShowLeaveModal(false);
            setLeaveForm({ leaveFrom: "", leaveTo: "", reason: "", leaveFromDate: "", leaveFromTime: "09:00", leaveToDate: "", leaveToTime: "18:00" });
            await fetchTodayStatus();
            await fetchMyAttendance();
        } catch (e: any) {
            setAttError(e?.response?.data?.error || "Failed to apply for leave");
        } finally { setAttActionLoading(false); }
    };

    const handleConfirmLeaveEnd = async (leaveId: string) => {
        setAttActionLoading(true);
        try {
            await attendanceAPI.confirmLeaveEnd(leaveId);
            setShowLeaveEndModal(false);
            await fetchTodayStatus();
        } catch (e: any) {
            setAttError(e?.response?.data?.error || "Failed to confirm leave end");
        } finally { setAttActionLoading(false); }
    };

    const handleRequestHoliday = async () => {
        setAttActionLoading(true);
        setAttError("");
        try {
            await attendanceAPI.requestHoliday(holidayForm);
            setShowHolidayModal(false);
            setHolidayForm({ holidayDate: "", description: "" });
            await fetchMyAttendance();
        } catch (e: any) {
            setAttError(e?.response?.data?.error || "Failed to request holiday");
        } finally { setAttActionLoading(false); }
    };

    const statusColor = (status: string) => {
        switch (status) {
            case "PRESENT": return "text-emerald-400";
            case "EARLY_CHECKOUT": return "text-amber-400";
            case "OVERTIME": return "text-blue-400";
            case "ON_LEAVE": return "text-purple-400";
            case "HOLIDAY": return "text-pink-400";
            default: return "text-slate-400";
        }
    };

    useEffect(() => {
        if (tab === "history") {
            setHistoryLoading(true);
            jobsAPI.list()
                .then(res => setHistory(res.data))
                .catch(err => console.error("Failed to load history", err))
                .finally(() => setHistoryLoading(false));
        }
    }, [tab]);

    const createJob = async () => {
        if (!vehicleNumber.trim()) { setError("Vehicle number is required"); return; }
        setLoading(true);
        setError("");
        try {
            const res = await jobsAPI.create({ vehicleNumber, jobType, notes: "", insuranceCompany: jobType === "ACCIDENT_RECOVERY" ? insuranceCompany : undefined });
            setJob(res.data);
            setStep("before_images");
        } catch (err: unknown) {
            const e = err as { response?: { data?: { error?: string } } };
            setError(e.response?.data?.error || "Failed to create job");
        } finally {
            setLoading(false);
        }
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream);
            const chunks: BlobPart[] = [];

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunks.push(e.data);
            };

            recorder.onstop = () => {
                const mimeType = recorder.mimeType || "audio/webm";
                const blob = new Blob(chunks, { type: mimeType });
                setAudioBlob(blob);
                setAudioUrl(URL.createObjectURL(blob));
                stream.getTracks().forEach(track => track.stop());
            };

            recorder.start(100); // Safari needs timeslices or might fail to fire ondataavailable
            setMediaRecorder(recorder);
            setIsRecording(true);
        } catch (err) {
            console.error(err);
            setError("Could not access microphone.");
        }
    };

    const stopRecording = () => {
        if (mediaRecorder && isRecording) {
            mediaRecorder.stop();
            setIsRecording(false);
        }
    };

    const clearAudio = () => {
        setAudioBlob(null);
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl(null);
    };

    const submitJob = async () => {
        if (!job) return;
        setLoading(true);
        setError("");
        try {
            let voiceNoteUrl = undefined;
            if (audioBlob) {
                const formData = new FormData();
                const ext = audioBlob.type.includes("mp4") ? ".mp4" : ".webm";
                formData.append("voice", audioBlob, `voice-note${ext}`);
                const res = await voiceAPI.upload(formData);
                voiceNoteUrl = res.data.url;
            }

            await jobsAPI.update(job.id, { notes, insuranceCompany, voiceNoteUrl });
            await jobsAPI.submit(job.id);
            setStep("done");
        } catch {
            setError("Failed to submit. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const reset = () => {
        setStep("select_type");
        setJob(null);
        setVehicleNumber("");
        setNotes("");
        setInsuranceCompany("");
        setBeforeImages([]);
        setAfterImages([]);
        clearAudio();
        setError("");
    };

    const steps = ["select_type", "before_images", "after_images", "notes"];
    const currentStepIndex = steps.indexOf(step);
    const stepLabels = ["Job Type", "Before Photos", "After Photos", "Notes & Submit"];

    if (step === "done") {
        return (
            <DashboardLayout title="Employee Dashboard" subtitle={`Welcome, ${user?.name}`}>
                <div className="max-w-lg mx-auto text-center animate-fade-in">
                    <div className="card">
                        <div className="w-20 h-20 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-6">
                            <CheckCircle className="w-10 h-10 text-emerald-400" />
                        </div>
                        <h2 className="text-2xl font-bold text-white mb-2">Job Submitted!</h2>
                        <p className="text-slate-400 mb-2">Job #{job?.jobNumber} has been sent to the admin for review.</p>
                        <p className="text-slate-500 text-sm mb-6">The admin will review your submission and proceed with the quotation.</p>
                        <button onClick={reset} className="btn-primary w-full">
                            <Plus className="w-4 h-4 inline mr-2" />Create Another Job
                        </button>
                    </div>
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout
            title="Employee Dashboard"
            subtitle={`Welcome, ${user?.name}. Create and review your vehicle jobs below.`}
            actions={<button onClick={() => { setTab("create"); reset(); }} className="btn-secondary text-sm"><Plus className="w-4 h-4 inline mr-1" />New Job</button>}
        >
            <div className="flex gap-2 mb-6 max-w-2xl mx-auto flex-wrap">
                {([
                    { key: "create", label: "Create Job", icon: <Plus className="w-3.5 h-3.5" /> },
                    { key: "history", label: "My Submitted Jobs", icon: <FileText className="w-3.5 h-3.5" /> },
                    { key: "attendance", label: "Attendance", icon: <CalendarClock className="w-3.5 h-3.5" /> },
                ] as const).map(t => (
                    <button key={t.key} onClick={() => setTab(t.key as Tab)} className={`tab-btn flex items-center gap-1.5 ${tab === t.key ? "active" : ""}`}>
                        {t.icon}{t.label}
                    </button>
                ))}
            </div>

            {tab === "history" ? (
                <div className="max-w-2xl mx-auto animate-fade-in space-y-3">
                    {historyLoading ? (
                        <div className="text-center py-10 text-slate-500">Loading history...</div>
                    ) : history.length === 0 ? (
                        <div className="card text-center py-12">
                            <Clock className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                            <h3 className="text-lg font-medium text-slate-300">No jobs found</h3>
                            <p className="text-slate-500 text-sm mt-1">You haven't submitted any jobs yet.</p>
                            <button onClick={() => setTab("create")} className="btn-primary mt-6">Create New Job</button>
                        </div>
                    ) : (
                        history.map((job) => (
                            <div key={job.id} className="card hover:bg-white/5 transition-colors group flex items-center justify-between p-4">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-mono text-sm font-semibold text-white">{job.vehicle.vehicleNumber}</span>
                                        <span className="bg-white/10 px-2 py-0.5 rounded text-[10px] text-slate-300">Job #{job.jobNumber}</span>
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${job.status === "DRAFT" ? "bg-slate-500/20 text-slate-300" :
                                            job.status === "SUBMITTED" ? "bg-blue-500/20 text-blue-300" :
                                                job.status === "REVIEWED" ? "bg-amber-500/20 text-amber-300" :
                                                    "bg-emerald-500/20 text-emerald-300"
                                            }`}>{job.status}</span>
                                    </div>
                                    <div className="text-xs text-slate-500 flex items-center gap-3">
                                        <span>{job.jobType.replace("_", " ")}</span>
                                        <span>•</span>
                                        <span>{new Date(job.createdAt).toLocaleDateString()}</span>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    <div className="flex -space-x-2">
                                        {job.images?.slice(0, 3).map((img: any, i: number) => (
                                            <div key={img.id} className="w-6 h-6 rounded-full bg-slate-800 border-2 border-slate-900 overflow-hidden relative z-10" style={{ zIndex: 10 - i }}>
                                                <img src={`${process.env.NEXT_PUBLIC_API_URL?.replace('/api', '')}${img.url}`} className="w-full h-full object-cover" alt="" />
                                            </div>
                                        ))}
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={() => setViewingJob(job)} className="btn-secondary text-xs mt-2">
                                            <Eye className="w-3.5 h-3.5 inline mr-1" />View Details
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            ) : (
                <div className="max-w-2xl mx-auto animate-fade-in">
                    {/* Progress steps */}
                    <div className="flex items-center gap-2 mb-8">
                        {stepLabels.map((label, i) => (
                            <div key={i} className="flex items-center gap-2 flex-1">
                                <div className={`flex items-center gap-1.5 ${i <= currentStepIndex ? "opacity-100" : "opacity-30"}`}>
                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i < currentStepIndex ? "bg-emerald-500 text-white" : i === currentStepIndex ? "bg-blue-600 text-white" : "bg-white/10 text-slate-400"}`}>
                                        {i < currentStepIndex ? "✓" : i + 1}
                                    </div>
                                    <span className={`text-xs font-medium hidden sm:block ${i === currentStepIndex ? "text-blue-300" : i < currentStepIndex ? "text-emerald-300" : "text-slate-500"}`}>{label}</span>
                                </div>
                                {i < stepLabels.length - 1 && (
                                    <div className={`h-px flex-1 mx-1 ${i < currentStepIndex ? "bg-emerald-500/50" : "bg-white/10"}`} />
                                )}
                            </div>
                        ))}
                    </div>

                    {/* STEP 1: Select type + vehicle */}
                    {step === "select_type" && (
                        <div className="space-y-6">
                            <div className="card">
                                <h3 className="text-base font-semibold mb-4">Vehicle Information</h3>
                                <div>
                                    <label className="block text-sm text-slate-400 mb-1.5">Vehicle Number *</label>
                                    <input
                                        value={vehicleNumber}
                                        onChange={e => setVehicleNumber(e.target.value.toUpperCase())}
                                        placeholder="e.g. CAA-1234"
                                        className="input-field font-mono"
                                    />
                                </div>
                            </div>

                            <div className="card">
                                <h3 className="text-base font-semibold mb-4">Select Job Type</h3>
                                <div className="grid gap-3">
                                    {JOB_TYPES.map(jt => (
                                        <button
                                            key={jt.value}
                                            onClick={() => setJobType(jt.value)}
                                            className={`flex items-center gap-4 p-4 rounded-xl border text-left transition-all duration-200 ${jobType === jt.value ? `border-${jt.color}-500/50 bg-${jt.color}-600/10` : "border-white/10 bg-white/3 hover:bg-white/7"}`}
                                        >
                                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${jobType === jt.value ? `bg-${jt.color}-500/20 text-${jt.color}-400` : "bg-white/5 text-slate-500"}`}>
                                                {jt.icon}
                                            </div>
                                            <div>
                                                <div className={`font-medium ${jobType === jt.value ? "text-white" : "text-slate-300"}`}>{jt.label}</div>
                                                <div className="text-sm text-slate-500">{jt.desc}</div>
                                            </div>
                                            <div className={`ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center ${jobType === jt.value ? `border-${jt.color}-400 bg-${jt.color}-400` : "border-white/20"}`}>
                                                {jobType === jt.value && <div className="w-2 h-2 rounded-full bg-white" />}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {jobType === "ACCIDENT_RECOVERY" && (
                                <div className="card border-red-500/20">
                                    <h3 className="text-base font-semibold mb-4 text-red-300">Insurance Details</h3>
                                    <div>
                                        <label className="block text-sm text-slate-400 mb-1.5">Insurance Company</label>
                                        <input value={insuranceCompany} onChange={e => setInsuranceCompany(e.target.value)} placeholder="e.g. Ceylinco Insurance" className="input-field" />
                                    </div>
                                </div>
                            )}

                            {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">{error}</div>}

                            <button onClick={createJob} className="btn-primary w-full" disabled={loading}>
                                {loading ? "Creating Job…" : "Continue — Take Before Photos →"}
                            </button>
                        </div>
                    )}

                    {/* STEP 2: Before images */}
                    {step === "before_images" && job && (
                        <div className="space-y-4">
                            <div className="card">
                                <div className="flex items-center gap-3 mb-2">
                                    <Car className="w-5 h-5 text-amber-400" />
                                    <div>
                                        <h3 className="font-semibold">Before Service Photos</h3>
                                        <p className="text-sm text-slate-500">Job #{job.jobNumber} · {vehicleNumber}</p>
                                    </div>
                                </div>
                                <p className="text-slate-400 text-sm mb-4">Take photos of all sides of the vehicle before starting work.</p>
                                <ImageUploader
                                    jobId={job.id}
                                    phase="BEFORE"
                                    label="Vehicle Before Service"
                                    description="Front, back, left side, right side, interior (dashboard, seats), and any existing damage"
                                    onUploaded={(imgs) => setBeforeImages(imgs)}
                                />
                            </div>

                            <div className="flex gap-3">
                                <button onClick={() => setStep("select_type")} className="btn-secondary flex-1">← Back</button>
                                <button onClick={() => setStep("after_images")} className="btn-primary flex-1" disabled={beforeImages.length === 0}>
                                    Continue — After Photos →
                                </button>
                            </div>
                            {beforeImages.length === 0 && <p className="text-amber-400 text-xs text-center">Please upload at least one before photo</p>}
                        </div>
                    )}

                    {/* STEP 3: After images */}
                    {step === "after_images" && job && (
                        <div className="space-y-4">
                            <div className="card">
                                <div className="flex items-center gap-3 mb-2">
                                    <CheckCircle className="w-5 h-5 text-emerald-400" />
                                    <div>
                                        <h3 className="font-semibold">After Service & Parts Photos</h3>
                                        <p className="text-sm text-slate-500">Job #{job.jobNumber} · {vehicleNumber}</p>
                                    </div>
                                </div>
                                <p className="text-slate-400 text-sm mb-4">Upload photos after completing work and photos of all replaced parts.</p>

                                <div className="space-y-4">
                                    <ImageUploader
                                        jobId={job.id}
                                        phase="AFTER"
                                        label="Vehicle After Service"
                                        description="Same angles as before — front, back, sides, interior"
                                        onUploaded={(imgs) => setAfterImages(imgs)}
                                    />
                                    <ImageUploader
                                        jobId={job.id}
                                        phase="PART"
                                        label="Replaced Parts"
                                        description="Photo of each part that was replaced or repaired"
                                        onUploaded={() => { }}
                                    />
                                </div>
                            </div>

                            <div className="flex gap-3">
                                <button onClick={() => setStep("before_images")} className="btn-secondary flex-1">← Back</button>
                                <button onClick={() => setStep("notes")} className="btn-primary flex-1" disabled={afterImages.length === 0}>
                                    Continue — Add Notes →
                                </button>
                            </div>
                            {afterImages.length === 0 && <p className="text-amber-400 text-xs text-center">Please upload at least one after photo</p>}
                        </div>
                    )}

                    {/* STEP 4: Notes + submit */}
                    {step === "notes" && job && (
                        <div className="space-y-4">
                            <div className="card">
                                <h3 className="font-semibold mb-4">Service Notes</h3>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm text-slate-400 mb-1.5">Parts Replaced / Work Done *</label>
                                        <textarea
                                            value={notes}
                                            onChange={e => setNotes(e.target.value)}
                                            rows={6}
                                            placeholder="Describe exactly what work was done and what parts were replaced. Be as specific as possible.&#10;&#10;Example:&#10;- Replaced engine oil (Castrol 10W-40, 4L)&#10;- Replaced oil filter&#10;- Checked and adjusted brake pads&#10;- Cleaned air filter"
                                            className="input-field resize-none"
                                        />
                                        <p className="text-slate-600 text-xs mt-1">{notes.length} characters</p>
                                    </div>

                                    {jobType === "ACCIDENT_RECOVERY" && (
                                        <div>
                                            <label className="block text-sm text-slate-400 mb-1.5">Insurance Company</label>
                                            <input value={insuranceCompany} onChange={e => setInsuranceCompany(e.target.value)} placeholder="Insurance company name" className="input-field" />
                                        </div>
                                    )}

                                    <div>
                                        <label className="block text-sm text-slate-400 mb-1.5">Voice Note (Optional)</label>
                                        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                                            {!audioUrl ? (
                                                <div className="flex items-center justify-between">
                                                    <span className="text-sm text-slate-400">Record a brief explanation of the issue</span>
                                                    <button
                                                        onClick={isRecording ? stopRecording : startRecording}
                                                        className={`btn-secondary text-sm ${isRecording ? "bg-red-500/20 text-red-400 border-red-500/50 hover:bg-red-500/30" : ""}`}
                                                    >
                                                        {isRecording ? "⏹ Stop Recording" : "🎤 Start Recording"}
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-4">
                                                    <audio src={audioUrl} controls className="h-10 flex-1" />
                                                    <button onClick={clearAudio} className="btn-secondary text-sm bg-red-500/10 text-red-400 hover:bg-red-500/20 border-0">
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            )}
                                            {isRecording && <div className="mt-3 flex items-center gap-2 text-xs text-red-400 animate-pulse">
                                                <div className="w-2 h-2 rounded-full bg-red-500"></div> Recording in progress...
                                            </div>}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="card border-blue-500/20 bg-blue-500/5">
                                <h4 className="text-sm font-medium text-blue-300 mb-2">Ready to submit?</h4>
                                <p className="text-xs text-slate-500">Once submitted, the admin will receive this job for review. You cannot edit it after submission.</p>
                            </div>

                            {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">{error}</div>}

                            <div className="flex gap-3">
                                <button onClick={() => setStep("after_images")} className="btn-secondary flex-1">← Back</button>
                                <button onClick={submitJob} className="btn-success flex-1" disabled={loading || !notes.trim()}>
                                    <Send className="w-4 h-4 inline mr-2" />
                                    {loading ? "Submitting…" : "Submit to Admin"}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── ATTENDANCE TAB ── */}
            {tab === "attendance" && (
                <div className="max-w-2xl mx-auto animate-fade-in space-y-4">
                    {attLoading && <div className="text-center py-10 text-slate-500">Loading attendance…</div>}
                    {attError && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">{attError}</div>}

                    {/* Today's Status Card */}
                    <div className="card border-blue-500/20">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="font-semibold text-blue-300 flex items-center gap-2"><CalendarClock className="w-4 h-4" />Today's Attendance</h3>
                            <span className="text-xs text-slate-500">{new Date().toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</span>
                        </div>

                        {todayStatus?.holiday && (
                            <div className="bg-pink-500/10 border border-pink-500/30 rounded-xl p-3 text-sm text-pink-300 mb-3">Holiday — {todayStatus.holiday.description || todayStatus.holiday.holidayDate}</div>
                        )}
                        {todayStatus?.activeLeave && (
                            <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-3 text-sm text-purple-300 mb-3">
                                On Approved Leave until {new Date(todayStatus.activeLeave.leaveTo).toLocaleDateString()}
                            </div>
                        )}

                        {/* Attendance record */}
                        <div className="grid grid-cols-2 gap-3 mb-4">
                            <div className="bg-white/5 rounded-xl p-3">
                                <p className="text-xs text-slate-500 mb-1">Check-in</p>
                                <p className={`font-semibold ${todayStatus?.attendance?.checkInTime ? "text-emerald-400" : "text-slate-500"}`}>
                                    {todayStatus?.attendance?.checkInTime ? new Date(todayStatus.attendance.checkInTime).toLocaleTimeString() : "—"}
                                </p>
                            </div>
                            <div className="bg-white/5 rounded-xl p-3">
                                <p className="text-xs text-slate-500 mb-1">Check-out</p>
                                <p className={`font-semibold ${todayStatus?.attendance?.checkOutTime ? "text-amber-400" : "text-slate-500"}`}>
                                    {todayStatus?.attendance?.checkOutTime ? new Date(todayStatus.attendance.checkOutTime).toLocaleTimeString() : "—"}
                                </p>
                            </div>
                        </div>

                        {todayStatus?.attendance?.status && (
                            <div className="mb-3">
                                <span className={`text-sm font-medium ${statusColor(todayStatus.attendance.status)}`}>Status: {todayStatus.attendance.status.replace("_", " ")}</span>
                            </div>
                        )}

                        {/* Pending requests */}
                        {(todayStatus?.pendingRequests?.length ?? 0) > 0 && (
                            <div className="space-y-1 mb-3">
                                {todayStatus!.pendingRequests.map(r => (
                                    <div key={r.id} className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-xs text-amber-300">
                                        {r.type.replace(/_/g, " ")} — Pending admin approval
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex flex-wrap gap-2 mt-2">
                            {/* Check-in button */}
                            {!todayStatus?.attendance && !todayStatus?.pendingRequests.some(r => r.type === "CHECKIN") && !todayStatus?.activeLeave && !todayStatus?.holiday && (
                                <button onClick={() => setShowCheckInModal(true)} className="btn-primary text-sm flex items-center gap-1.5">
                                    <LogIn className="w-4 h-4" />Check In
                                </button>
                            )}
                            {/* Check-out button */}
                            {todayStatus?.attendance?.checkInTime && !todayStatus.attendance.checkOutTime &&
                                !todayStatus.pendingRequests.some(r => r.type === "CHECKOUT" || r.type === "EARLY_CHECKOUT") && (
                                    <button onClick={() => setShowCheckoutModal(true)} className="btn-secondary text-sm flex items-center gap-1.5">
                                        <LogOut className="w-4 h-4" />Check Out
                                    </button>
                                )}
                            {/* Overtime button */}
                            {todayStatus?.attendance?.checkInTime && !todayStatus.activeOvertime &&
                                !todayStatus.pendingRequests.some(r => r.type === "OVERTIME_START") && (
                                    <button onClick={() => setShowOvertimeModal(true)} className="bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 text-sm px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors">
                                        <Star className="w-4 h-4" />Request Overtime
                                    </button>
                                )}
                            {/* End overtime */}
                            {todayStatus?.activeOvertime && (
                                <button onClick={() => handleOvertimeEnd(todayStatus.activeOvertime!.id)} disabled={attActionLoading} className="bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 text-sm px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors">
                                    <CheckCircle className="w-4 h-4" />Confirm Overtime Complete
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="grid grid-cols-2 gap-3">
                        <button onClick={() => setShowLeaveModal(true)} className="card flex items-center gap-3 hover:bg-white/5 transition-colors text-left">
                            <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                                <Umbrella className="w-5 h-5 text-purple-400" />
                            </div>
                            <div>
                                <p className="font-medium text-sm text-white">Apply for Leave</p>
                                <p className="text-xs text-slate-500">Submit leave request</p>
                            </div>
                        </button>
                        <button onClick={() => setShowHolidayModal(true)} className="card flex items-center gap-3 hover:bg-white/5 transition-colors text-left">
                            <div className="w-10 h-10 rounded-xl bg-pink-500/20 flex items-center justify-center flex-shrink-0">
                                <Calendar className="w-5 h-5 text-pink-400" />
                            </div>
                            <div>
                                <p className="font-medium text-sm text-white">Request Holiday</p>
                                <p className="text-xs text-slate-500">Apply for a day off</p>
                            </div>
                        </button>
                    </div>

                    {/* My Records */}
                    {myAttendance && (
                        <div className="space-y-4">
                            {/* Recent attendance */}
                            <div className="card">
                                <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2"><Clock className="w-4 h-4" />Recent Attendance</h4>
                                {myAttendance.attendance.length === 0 ? (
                                    <p className="text-sm text-slate-500">No attendance records yet.</p>
                                ) : (
                                    <div className="space-y-2">
                                        {myAttendance.attendance.slice(0, 7).map((a: any) => (
                                            <div key={a.id} className="flex items-center justify-between text-sm border-b border-white/5 pb-2">
                                                <span className="text-slate-300">{new Date(a.date).toLocaleDateString("en-GB")}</span>
                                                <div className="flex items-center gap-3">
                                                    <span className="text-slate-500 text-xs">{a.checkInTime ? new Date(a.checkInTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"} → {a.checkOutTime ? new Date(a.checkOutTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                                                    <span className={`text-xs font-medium ${statusColor(a.status)}`}>{a.status.replace("_", " ")}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Leave history */}
                            {myAttendance.leaves.length > 0 && (
                                <div className="card">
                                    <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2"><Umbrella className="w-4 h-4" />Leave Requests</h4>
                                    <div className="space-y-2">
                                        {myAttendance.leaves.map((l: any) => (
                                            <div key={l.id} className="flex items-center justify-between text-sm border-b border-white/5 pb-2">
                                                <div>
                                                    <span className="text-slate-300">{new Date(l.leaveFrom).toLocaleDateString()} – {new Date(l.leaveTo).toLocaleDateString()}</span>
                                                    {l.reason && <p className="text-xs text-slate-500">{l.reason}</p>}
                                                </div>
                                                <span className={`text-xs font-medium px-2 py-0.5 rounded ${l.status === "APPROVED" ? "bg-emerald-500/20 text-emerald-300" : l.status === "REJECTED" ? "bg-red-500/20 text-red-300" : "bg-amber-500/20 text-amber-300"}`}>{l.status}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Overtime history */}
                            {myAttendance.overtimes.length > 0 && (
                                <div className="card">
                                    <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2"><Coffee className="w-4 h-4" />Overtime Requests</h4>
                                    <div className="space-y-2">
                                        {myAttendance.overtimes.map((o: any) => (
                                            <div key={o.id} className="flex items-center justify-between text-sm border-b border-white/5 pb-2">
                                                <div>
                                                    <span className="text-slate-300">{new Date(o.overtimeStart).toLocaleDateString()}</span>
                                                    {o.reason && <p className="text-xs text-slate-500">{o.reason}</p>}
                                                </div>
                                                <span className={`text-xs font-medium px-2 py-0.5 rounded ${o.status === "APPROVED" ? "bg-blue-500/20 text-blue-300" : o.status === "COMPLETED" ? "bg-emerald-500/20 text-emerald-300" : o.status === "REJECTED" ? "bg-red-500/20 text-red-300" : "bg-amber-500/20 text-amber-300"}`}>{o.status}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Holiday history */}
                            {myAttendance.holidays.length > 0 && (
                                <div className="card">
                                    <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2"><Calendar className="w-4 h-4" />Holiday Requests</h4>
                                    <div className="space-y-2">
                                        {myAttendance.holidays.map((h: any) => (
                                            <div key={h.id} className="flex items-center justify-between text-sm border-b border-white/5 pb-2">
                                                <div>
                                                    <span className="text-slate-300">{new Date(h.holidayDate).toLocaleDateString()}</span>
                                                    {h.description && <p className="text-xs text-slate-500">{h.description}</p>}
                                                </div>
                                                <span className={`text-xs font-medium px-2 py-0.5 rounded ${h.status === "APPROVED" ? "bg-emerald-500/20 text-emerald-300" : h.status === "REJECTED" ? "bg-red-500/20 text-red-300" : "bg-amber-500/20 text-amber-300"}`}>{h.status}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ── CHECK-IN MODAL (auto-popup on first login of day) ── */}
            {showCheckInModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                    <div className="card max-w-sm w-full animate-fade-in text-center">
                        <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
                            <LogIn className="w-8 h-8 text-emerald-400" />
                        </div>
                        <h3 className="text-lg font-bold text-white mb-1">Mark Your Attendance</h3>
                        <p className="text-slate-400 text-sm mb-1">{new Date().toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
                        <p className="text-slate-500 text-xs mb-6">{new Date().toLocaleTimeString()}</p>
                        {attError && <p className="text-red-400 text-sm mb-3">{attError}</p>}
                        <div className="flex gap-3">
                            <button onClick={() => setShowCheckInModal(false)} className="btn-secondary flex-1">Later</button>
                            <button onClick={handleCheckIn} disabled={attActionLoading} className="btn-primary flex-1">
                                <LogIn className="w-4 h-4 inline mr-1" />
                                {attActionLoading ? "Sending…" : "Check In"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── CHECK-OUT MODAL ── */}
            {showCheckoutModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                    <div className="card max-w-sm w-full animate-fade-in">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-semibold flex items-center gap-2"><LogOut className="w-4 h-4 text-amber-400" />Check Out</h3>
                            <button onClick={() => setShowCheckoutModal(false)}><X className="w-5 h-5 text-slate-500" /></button>
                        </div>
                        <p className="text-sm text-slate-400 mb-3">Current time: <span className="text-white font-medium">{new Date().toLocaleTimeString()}</span></p>
                        {new Date().getHours() < 17 && (
                            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-amber-300 text-sm mb-3">
                                <AlertCircle className="w-4 h-4 inline mr-1" />This will be recorded as an early checkout.
                            </div>
                        )}
                        <div className="mb-4">
                            <label className="block text-xs text-slate-400 mb-1">Reason (required for early checkout)</label>
                            <input value={checkoutReason} onChange={e => setCheckoutReason(e.target.value)} placeholder="Reason for early checkout…" className="input-field text-sm" />
                        </div>
                        {attError && <p className="text-red-400 text-sm mb-3">{attError}</p>}
                        <div className="flex gap-3">
                            <button onClick={() => setShowCheckoutModal(false)} className="btn-secondary flex-1">Cancel</button>
                            <button onClick={handleCheckOut} disabled={attActionLoading} className="btn-primary flex-1">
                                {attActionLoading ? "Sending…" : "Confirm Checkout"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── OVERTIME MODAL ── */}
            {showOvertimeModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                    <div className="card max-w-sm w-full animate-fade-in">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-semibold flex items-center gap-2"><Star className="w-4 h-4 text-blue-400" />Request Overtime</h3>
                            <button onClick={() => setShowOvertimeModal(false)}><X className="w-5 h-5 text-slate-500" /></button>
                        </div>
                        <p className="text-sm text-slate-400 mb-4">Describe what work you will be doing during overtime.</p>
                        <textarea value={overtimeReason} onChange={e => setOvertimeReason(e.target.value)} rows={3} placeholder="e.g. Completing engine rebuild for Job #42" className="input-field text-sm resize-none mb-4" />
                        {attError && <p className="text-red-400 text-sm mb-3">{attError}</p>}
                        <div className="flex gap-3">
                            <button onClick={() => setShowOvertimeModal(false)} className="btn-secondary flex-1">Cancel</button>
                            <button onClick={handleOvertimeStart} disabled={attActionLoading || !overtimeReason.trim()} className="btn-primary flex-1">
                                {attActionLoading ? "Sending…" : "Request Overtime"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── LEAVE MODAL ── */}
            {showLeaveModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                    <div className="card max-w-sm w-full animate-fade-in">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-semibold flex items-center gap-2"><Umbrella className="w-4 h-4 text-purple-400" />Apply for Leave</h3>
                            <button onClick={() => { setShowLeaveModal(false); setAttError(""); }}><X className="w-5 h-5 text-slate-500" /></button>
                        </div>
                        <div className="space-y-3 mb-4">
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">From Date (YYYY-MM-DD) *</label>
                                <input
                                    type="text"
                                    placeholder="2026-10-15"
                                    value={leaveForm.leaveFromDate}
                                    onChange={e => setLeaveForm(f => ({ ...f, leaveFromDate: e.target.value }))}
                                    className="input-field text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">From Time (HH:MM) *</label>
                                <input
                                    type="text"
                                    placeholder="09:00"
                                    value={leaveForm.leaveFromTime}
                                    onChange={e => setLeaveForm(f => ({ ...f, leaveFromTime: e.target.value }))}
                                    className="input-field text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">To Date (YYYY-MM-DD) *</label>
                                <input
                                    type="text"
                                    placeholder="2026-10-17"
                                    value={leaveForm.leaveToDate}
                                    onChange={e => setLeaveForm(f => ({ ...f, leaveToDate: e.target.value }))}
                                    className="input-field text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">To Time (HH:MM) *</label>
                                <input
                                    type="text"
                                    placeholder="18:00"
                                    value={leaveForm.leaveToTime}
                                    onChange={e => setLeaveForm(f => ({ ...f, leaveToTime: e.target.value }))}
                                    className="input-field text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Reason</label>
                                <textarea value={leaveForm.reason} onChange={e => setLeaveForm(f => ({ ...f, reason: e.target.value }))} rows={2} placeholder="Reason for leave…" className="input-field text-sm resize-none" />
                            </div>
                        </div>
                        {attError && <p className="text-red-400 text-sm mb-3">{attError}</p>}
                        <div className="flex gap-3">
                            <button onClick={() => { setShowLeaveModal(false); setAttError(""); }} className="btn-secondary flex-1">Cancel</button>
                            <button onClick={handleApplyLeave} disabled={attActionLoading} className="btn-primary flex-1">
                                {attActionLoading ? "Sending…" : "Submit Leave Request"}
                            </button>
                        </div>
                    </div>
                </div>
            )}


            {/* ── HOLIDAY MODAL ── */}
            {showHolidayModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                    <div className="card max-w-sm w-full animate-fade-in">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-semibold flex items-center gap-2"><Calendar className="w-4 h-4 text-pink-400" />Request Holiday</h3>
                            <button onClick={() => setShowHolidayModal(false)}><X className="w-5 h-5 text-slate-500" /></button>
                        </div>
                        <div className="space-y-3 mb-4">
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Holiday Date *</label>
                                <input type="date" value={holidayForm.holidayDate} onChange={e => setHolidayForm(f => ({ ...f, holidayDate: e.target.value }))} className="input-field text-sm" required />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Description / Reason</label>
                                <textarea value={holidayForm.description} onChange={e => setHolidayForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="Reason for holiday request…" className="input-field text-sm resize-none" />
                            </div>
                        </div>
                        {attError && <p className="text-red-400 text-sm mb-3">{attError}</p>}
                        <div className="flex gap-3">
                            <button onClick={() => setShowHolidayModal(false)} className="btn-secondary flex-1">Cancel</button>
                            <button onClick={handleRequestHoliday} disabled={attActionLoading || !holidayForm.holidayDate} className="btn-primary flex-1">
                                {attActionLoading ? "Sending…" : "Submit Holiday Request"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── LEAVE END CONFIRMATION MODAL ── */}
            {showLeaveEndModal && todayStatus?.activeLeave && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                    <div className="card max-w-sm w-full animate-fade-in text-center">
                        <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
                            <CheckCircle className="w-8 h-8 text-emerald-400" />
                        </div>
                        <h3 className="text-lg font-bold text-white mb-2">Your Leave Has Ended</h3>
                        <p className="text-slate-400 text-sm mb-6">Please confirm that you are back and available to work.</p>
                        {attError && <p className="text-red-400 text-sm mb-3">{attError}</p>}
                        <div className="flex gap-3">
                            <button onClick={() => setShowLeaveEndModal(false)} className="btn-secondary flex-1">Later</button>
                            <button onClick={() => handleConfirmLeaveEnd(todayStatus.activeLeave!.id)} disabled={attActionLoading} className="btn-primary flex-1">
                                {attActionLoading ? "Confirming…" : "I'm Back — Confirm"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal for viewing job details */}
            {viewingJob && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
                    <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
                        <div className="p-5 border-b border-white/10 flex justify-between items-center bg-white/5">
                            <div>
                                <h3 className="text-lg font-semibold text-white">Job Details #{viewingJob.jobNumber}</h3>
                                <p className="text-sm text-slate-400">{viewingJob.vehicle?.vehicleNumber} • {new Date(viewingJob.createdAt).toLocaleDateString()}</p>
                            </div>
                            <button onClick={() => setViewingJob(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors text-slate-400 hover:text-white">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto space-y-6">
                            <div className="grid sm:grid-cols-2 gap-4">
                                <div className="card bg-white/3">
                                    <p className="text-xs text-slate-500 mb-1">Status</p>
                                    <p className={`font-semibold ${viewingJob.status === "DRAFT" ? "text-slate-300" :
                                        viewingJob.status === "SUBMITTED" ? "text-blue-300" :
                                            viewingJob.status === "REVIEWED" ? "text-amber-300" :
                                                "text-emerald-300"
                                        }`}>{viewingJob.status}</p>
                                </div>
                                <div className="card bg-white/3">
                                    <p className="text-xs text-slate-500 mb-1">Job Type</p>
                                    <p className="font-semibold text-white">{viewingJob.jobType.replace("_", " ")}</p>
                                </div>
                            </div>

                            {viewingJob.notes && (
                                <div>
                                    <h4 className="text-sm font-semibold text-slate-300 mb-3 border-b border-white/10 pb-2">Service Notes</h4>
                                    <div className="bg-white/5 rounded-xl p-4 text-sm text-slate-300 whitespace-pre-wrap border border-white/5 mb-3">
                                        {viewingJob.notes}
                                    </div>
                                    {viewingJob.voiceNoteUrl && (
                                        <div className="mt-2 text-slate-400">
                                            <p className="text-xs mb-1">Attached Voice Note</p>
                                            <audio src={`${process.env.NEXT_PUBLIC_API_URL?.replace('/api', '')}${viewingJob.voiceNoteUrl}`} controls className="w-full h-10" />
                                        </div>
                                    )}
                                </div>
                            )}

                            {viewingJob.insuranceCompany && (
                                <div>
                                    <h4 className="text-sm font-semibold text-slate-300 mb-2">Insurance</h4>
                                    <div className="bg-red-500/10 border border-red-500/20 text-red-200 rounded-lg p-3 text-sm">
                                        {viewingJob.insuranceCompany}
                                    </div>
                                </div>
                            )}

                            {/* Images section */}
                            <div>
                                <h4 className="text-sm font-semibold text-slate-300 mb-3 border-b border-white/10 pb-2">Photos ({viewingJob.images?.length || 0})</h4>
                                {viewingJob.images && viewingJob.images.length > 0 ? (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                        {viewingJob.images.map((img: any) => (
                                            <div key={img.id} className="relative group">
                                                <a href={`${process.env.NEXT_PUBLIC_API_URL?.replace('/api', '')}${img.url}`} target="_blank" rel="noopener noreferrer">
                                                    <img
                                                        src={`${process.env.NEXT_PUBLIC_API_URL?.replace('/api', '')}${img.url}`}
                                                        alt="Job reference"
                                                        className="rounded-lg aspect-square object-cover w-full hover:scale-[1.02] transition-transform bg-slate-800"
                                                    />
                                                </a>
                                                <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-medium text-white border border-white/20">
                                                    {img.phase}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-sm text-slate-500 italic">No photos attached.</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </DashboardLayout>
    );
}
