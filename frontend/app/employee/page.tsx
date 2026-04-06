"use client";
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import ImageUploader from "@/components/ImageUploader";
import { jobsAPI } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Plus, Send, CheckCircle, Wrench, Car, Zap, AlertTriangle } from "lucide-react";

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

    const submitJob = async () => {
        if (!job) return;
        setLoading(true);
        setError("");
        try {
            await jobsAPI.update(job.id, { notes, insuranceCompany });
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
            subtitle={`Welcome, ${user?.name}. Create and submit vehicle jobs below.`}
            actions={<button onClick={reset} className="btn-secondary text-sm"><Plus className="w-4 h-4 inline mr-1" />New Job</button>}
        >
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
        </DashboardLayout>
    );
}
