"use client";
import { useState, useEffect, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { quotationsAPI, notificationsAPI, employeesAPI } from "@/lib/api";
import { formatDate, JOB_TYPE_LABELS } from "@/lib/utils";
import { Edit3, Download, Bell, Search, X, Plus, CheckCircle, FileText, DollarSign, Users } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type Tab = "quotations" | "search" | "employees";

interface QuotationItem {
    id?: string; description: string; partReplaced?: string; price: number; laborCost: number;
}

interface Job {
    id: string; jobNumber: number; jobType: string; notes: string; status: string;
    employee: { name: string }; images: { id: string; url: string; phase: string }[];
    insuranceCompany?: string; createdAt: string;
}

interface Quotation {
    id: string; vehicleNumber: string; ownerName?: string; telephone?: string;
    address?: string; vehicleType?: string; color?: string; insuranceCompany?: string;
    status: string; createdAt: string; jobDetails?: string;
    job: Job; items: QuotationItem[]; totalAmount?: number;
}

interface Notification { id: string; message: string; vehicleNumber?: string; isRead: boolean; createdAt: string; }

export default function ManagerDashboard() {
    const [tab, setTab] = useState<Tab>("quotations");
    const [quotations, setQuotations] = useState<Quotation[]>([]);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [editQ, setEditQ] = useState<Quotation | null>(null);
    const [editItems, setEditItems] = useState<QuotationItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [finalizing, setFinalizing] = useState(false);
    const [employees, setEmployees] = useState<any[]>([]);
    const [empLoading, setEmpLoading] = useState(false);

    // Search
    const [searchQ, setSearchQ] = useState("");
    const [searchType, setSearchType] = useState<"vehicleNumber" | "telephone">("vehicleNumber");
    const [searchResult, setSearchResult] = useState<{ vehicle: Record<string, string | undefined>; jobs: Job[] } | null>(null);
    const [searchError, setSearchError] = useState("");

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [qRes, nRes] = await Promise.all([quotationsAPI.list(), notificationsAPI.list()]);
            setQuotations(qRes.data);
            setNotifications(nRes.data);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    useEffect(() => {
        if (tab === "employees") {
            setEmpLoading(true);
            employeesAPI.list().then(r => setEmployees(r.data)).finally(() => setEmpLoading(false));
        }
    }, [tab]);

    const openEdit = (q: Quotation) => {
        setEditQ(q);
        setEditItems(q.items.length > 0 ? q.items.map(i => ({ ...i })) : [{ description: "", price: 0, laborCost: 0, partReplaced: "" }]);
    };

    const total = (items: QuotationItem[]) => items.reduce((s, i) => s + (i.price || 0) + (i.laborCost || 0), 0);

    const finalize = async () => {
        if (!editQ) return;
        setFinalizing(true);
        try {
            await quotationsAPI.finalize(editQ.id, { items: editItems.filter(i => i.description), totalAmount: total(editItems) });
            const updated = { ...editQ, items: editItems, totalAmount: total(editItems), status: "FINALIZED" };
            generatePDF(updated);
            setEditQ(null);
            fetchData();
        } catch { alert("Failed to finalize"); }
        finally { setFinalizing(false); }
    };

    const generatePDF = (q: Quotation) => {
        const doc = new jsPDF();
        // Header
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, 220, 40, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(22);
        doc.setFont("helvetica", "bold");
        doc.text("TRACK N FIX - SERVICE QUOTATION", 14, 20);
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.text("Jayakody Auto Electrical Automobile Workshop", 14, 30);
        doc.text(`Date: ${new Date().toLocaleDateString("en-GB")}`, 150, 20);
        doc.text(`Job No: #${q.job.jobNumber}`, 150, 28);

        // Vehicle details
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text("Vehicle & Customer Details", 14, 52);
        doc.setLineWidth(0.5);
        doc.setDrawColor(37, 99, 235);
        doc.line(14, 54, 196, 54);

        const details = [
            ["Vehicle Number", q.vehicleNumber], ["Owner Name", q.ownerName || "—"],
            ["Vehicle Type", q.vehicleType || "—"], ["Color", q.color || "—"],
            ["Telephone", q.telephone || "—"], ["Address", q.address || "—"],
        ];
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        details.forEach(([k, v], i) => {
            const col = i % 2 === 0 ? 14 : 110;
            const row = 62 + Math.floor(i / 2) * 10;
            doc.setFont("helvetica", "bold");
            doc.text(`${k}:`, col, row);
            doc.setFont("helvetica", "normal");
            doc.text(v || "—", col + 35, row);
        });

        const yStart = 62 + Math.ceil(details.length / 2) * 10 + 6;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text("Job Type", 14, yStart);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text(JOB_TYPE_LABELS[q.job.jobType] || q.job.jobType, 60, yStart);

        if (q.insuranceCompany) {
            doc.setFont("helvetica", "bold");
            doc.text("Insurance:", 14, yStart + 8);
            doc.setFont("helvetica", "normal");
            doc.text(q.insuranceCompany, 60, yStart + 8);
        }

        const itemsY = yStart + (q.insuranceCompany ? 20 : 12);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text("Itemized Quotation", 14, itemsY);
        doc.line(14, itemsY + 2, 196, itemsY + 2);

        autoTable(doc, {
            startY: itemsY + 6,
            head: [["#", "Description", "Part Replaced", "Parts Cost (LKR)", "Labor Cost (LKR)", "Total (LKR)"]],
            body: editItems.filter(i => i.description).map((item, idx) => [
                idx + 1,
                item.description,
                item.partReplaced || "—",
                item.price.toFixed(2),
                item.laborCost.toFixed(2),
                (item.price + item.laborCost).toFixed(2),
            ]),
            foot: [["", "", "GRAND TOTAL", "", "", `LKR ${total(editItems).toFixed(2)}`]],
            styles: { fontSize: 9, cellPadding: 3 },
            headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
            footStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
            alternateRowStyles: { fillColor: [248, 250, 252] },
        });

        const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY || 200;
        doc.setFont("helvetica", "italic");
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 100);
        doc.text("Thank you for choosing Jayakody Auto Electrical Automobile Workshop!", 14, finalY + 12);
        doc.text("This is a computer-generated quotation.", 14, finalY + 20);

        doc.save(`Quotation_${q.vehicleNumber}_Job${q.job.jobNumber}.pdf`);
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
            setSearchError("No records found.");
        }
    };

    const downloadServiceRecord = (result: { vehicle: Record<string, string | undefined>; jobs: Job[] }) => {
        const doc = new jsPDF();
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, 220, 40, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(20);
        doc.setFont("helvetica", "bold");
        doc.text("VEHICLE SERVICE RECORD", 14, 22);
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        doc.text(`Jayakody Auto Electrical · Generated: ${new Date().toLocaleDateString("en-GB")}`, 14, 32);

        const v = result.vehicle;
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.text("Vehicle Details", 14, 52);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        const vDetails = [["Registration", v.vehicleNumber], ["Owner", v.ownerName || "—"], ["Type", v.vehicleType || "—"], ["Color", v.color || "—"], ["Tel", v.telephone || "—"]];
        vDetails.forEach(([k, val], i) => {
            const col = i % 2 === 0 ? 14 : 110;
            const row = 60 + Math.floor(i / 2) * 8;
            doc.setFont("helvetica", "bold");
            doc.text(`${k}:`, col, row);
            doc.setFont("helvetica", "normal");
            doc.text(val || "—", col + 28, row);
        });

        const histY = 60 + Math.ceil(vDetails.length / 2) * 8 + 8;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text(`Service History (${result.jobs.length} records)`, 14, histY);

        autoTable(doc, {
            startY: histY + 4,
            head: [["Job #", "Date", "Type", "Status", "Notes"]],
            body: result.jobs.map(j => [
                `#${j.jobNumber}`,
                new Date(j.createdAt).toLocaleDateString("en-GB"),
                JOB_TYPE_LABELS[j.jobType] || j.jobType,
                j.status,
                (j.notes || "").substring(0, 60) + ((j.notes || "").length > 60 ? "…" : ""),
            ]),
            styles: { fontSize: 8, cellPadding: 2 },
            headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
            alternateRowStyles: { fillColor: [248, 250, 252] },
        });

        doc.save(`ServiceRecord_${v.vehicleNumber}.pdf`);
    };

    const unread = notifications.filter(n => !n.isRead).length;

    return (
        <DashboardLayout title="Manager Dashboard" subtitle="Review quotations, add pricing, and generate final PDFs">
            {/* Tabs */}
            <div className="flex gap-2 mb-6">
                {([
                    { key: "quotations", label: "Requested Quotations", icon: <FileText className="w-3.5 h-3.5" />, count: quotations.length as number | undefined },
                    { key: "search", label: "Search Records", icon: <Search className="w-3.5 h-3.5" />, count: undefined as number | undefined },
                    { key: "employees", label: "Employees", icon: <Users className="w-3.5 h-3.5" />, count: undefined as number | undefined },
                ] as const).map(t => (
                    <button key={t.key} onClick={() => setTab(t.key as Tab)} className={`tab-btn flex items-center gap-1.5 ${tab === t.key ? "active" : ""}`}>
                        {t.icon}{t.label}
                        {t.count !== undefined && t.count > 0 && (
                            <span className="ml-1 bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{t.count}</span>
                        )}
                    </button>
                ))}
                {unread > 0 && (
                    <div className="ml-auto flex items-center gap-1.5 badge badge-blue">
                        <Bell className="w-3 h-3" />{unread} new notification{unread !== 1 ? "s" : ""}
                    </div>
                )}
            </div>

            {/* ── EMPLOYEES (read-only) ── */}
            {tab === "employees" && (
                <div className="space-y-4 animate-fade-in">
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 text-blue-300 text-sm">
                        View-only: Employee management (create/deactivate) is available in the Admin dashboard.
                    </div>
                    {empLoading && <div className="text-center py-8 text-slate-500">Loading…</div>}
                    {!empLoading && employees.length === 0 && (
                        <div className="card text-center py-10 text-slate-500">No employees found.</div>
                    )}
                    <div className="space-y-3">
                        {employees.map(emp => (
                            <div key={emp.id} className="card flex items-center justify-between gap-4 flex-wrap">
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
                                        </div>
                                        <p className="text-xs text-slate-500">{emp.email}</p>
                                    </div>
                                </div>
                                <span className="text-xs text-slate-400 ml-auto">{emp._count?.jobs || 0} jobs submitted</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── QUOTATIONS ── */}

            {tab === "quotations" && (
                <div className="space-y-4 animate-fade-in">
                    {loading && <div className="text-center text-slate-500 py-10">Loading…</div>}
                    {!loading && quotations.length === 0 && (
                        <div className="card text-center py-10">
                            <DollarSign className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                            <p className="text-slate-500">No quotations awaiting review</p>
                        </div>
                    )}
                    {quotations.map(q => (
                        <div key={q.id} className="card glass-hover">
                            <div className="flex items-start justify-between gap-4 flex-wrap">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-semibold text-white">{q.vehicleNumber}</span>
                                        <span className={`badge ${q.status === "FINALIZED" ? "badge-green" : "badge-yellow"}`}>{q.status}</span>
                                        <span className="badge badge-blue">{JOB_TYPE_LABELS[q.job.jobType]}</span>
                                    </div>
                                    <p className="text-sm text-slate-400">{q.ownerName || "Unknown owner"} · {q.telephone || "No phone"}</p>
                                    <p className="text-sm text-slate-400">{q.vehicleType} · {q.color}</p>
                                    {q.totalAmount && <p className="text-emerald-400 font-medium text-sm mt-1">LKR {q.totalAmount.toFixed(2)}</p>}
                                    <p className="text-xs text-slate-600 mt-1">{formatDate(q.createdAt)} · {q.items.length} items</p>
                                </div>
                                <div className="flex gap-2 ml-auto flex-wrap">
                                    <button onClick={() => openEdit(q)} className="btn-secondary text-xs">
                                        <Edit3 className="w-3.5 h-3.5 inline mr-1" />Edit & Price
                                    </button>
                                    {q.status === "FINALIZED" && (
                                        <button onClick={() => generatePDF(q)} className="btn-primary text-xs">
                                            <Download className="w-3.5 h-3.5 inline mr-1" />Download PDF
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── SEARCH ── */}
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
                            <button onClick={handleSearch} className="btn-primary text-sm"><Search className="w-4 h-4 inline mr-1" />Search</button>
                        </div>
                    </div>
                    {searchError && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">{searchError}</div>}
                    {searchResult && (
                        <div className="space-y-4 animate-fade-in">
                            <div className="card border-blue-500/20">
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="font-semibold text-blue-300">Vehicle Details</h4>
                                    <button onClick={() => downloadServiceRecord(searchResult)} className="btn-success text-xs">
                                        <Download className="w-3.5 h-3.5 inline mr-1" />Download Service Record PDF
                                    </button>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                                    {[["Reg. No.", searchResult.vehicle.vehicleNumber], ["Owner", searchResult.vehicle.ownerName], ["Phone", searchResult.vehicle.telephone], ["Type", searchResult.vehicle.vehicleType], ["Color", searchResult.vehicle.color], ["Address", searchResult.vehicle.address]].map(([l, v]) => (
                                        <div key={l}><p className="text-xs text-slate-500">{l}</p><p className="text-slate-200">{v || "—"}</p></div>
                                    ))}
                                </div>
                            </div>
                            <h4 className="text-sm font-semibold text-slate-400">Service History ({searchResult.jobs.length} records)</h4>
                            {searchResult.jobs.map(job => (
                                <div key={job.id} className="card">
                                    <div className="flex items-start justify-between gap-2 flex-wrap">
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="badge badge-blue">#{job.jobNumber}</span>
                                                <span className={`badge ${job.jobType === "SERVICE" ? "badge-blue" : job.jobType === "REPAIR" ? "badge-yellow" : "badge-red"}`}>{JOB_TYPE_LABELS[job.jobType]}</span>
                                                <span className="badge badge-green">{job.status}</span>
                                            </div>
                                            <p className="text-xs text-slate-400 mt-1">{formatDate(job.createdAt)}</p>
                                            {job.notes && <p className="text-sm text-slate-300 mt-2 whitespace-pre-wrap">{job.notes}</p>}
                                        </div>
                                        <span className="text-xs text-slate-500">{job.images.length} photo{job.images.length !== 1 ? "s" : ""}</span>
                                    </div>
                                    {job.images.length > 0 && (
                                        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 mt-3">
                                            {job.images.slice(0, 12).map(img => (
                                                <a key={img.id} href={`http://localhost:5001${img.url}`} target="_blank" rel="noopener noreferrer">
                                                    <img src={`http://localhost:5001${img.url}`} alt="" className="rounded-lg aspect-square object-cover hover:scale-105 transition-transform" />
                                                </a>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ══ EDIT & PRICE QUOTATION MODAL ══ */}
            {editQ && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="card max-w-3xl w-full max-h-[90vh] overflow-y-auto animate-fade-in">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="font-semibold text-lg">Quotation — {editQ.vehicleNumber}</h3>
                                <p className="text-sm text-slate-500">Job #{editQ.job.jobNumber} · {JOB_TYPE_LABELS[editQ.job.jobType]}</p>
                            </div>
                            <button onClick={() => setEditQ(null)}><X className="w-5 h-5 text-slate-500" /></button>
                        </div>

                        {/* Vehicle & job info (read-only) */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm mb-4">
                            {[["Owner", editQ.ownerName], ["Phone", editQ.telephone], ["Type", editQ.vehicleType], ["Color", editQ.color], ["Address", editQ.address], ["Insurance", editQ.insuranceCompany]].map(([l, v]) => (
                                <div key={l}><p className="text-xs text-slate-500">{l}</p><p className="text-slate-200">{v || "—"}</p></div>
                            ))}
                        </div>

                        {/* Employee notes (read-only) */}
                        {editQ.job.notes && (
                            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 mb-4">
                                <p className="text-xs text-amber-400 font-medium mb-1">Work Notes (from employee)</p>
                                <p className="text-sm text-slate-300 whitespace-pre-wrap">{editQ.job.notes}</p>
                            </div>
                        )}

                        {/* Images */}
                        {editQ.job.images.length > 0 && (
                            <div className="mb-4">
                                <p className="text-xs text-slate-500 mb-2">Job Photos ({editQ.job.images.length})</p>
                                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                                    {editQ.job.images.map(img => (
                                        <a key={img.id} href={`http://localhost:5001${img.url}`} target="_blank" rel="noopener noreferrer">
                                            <img src={`http://localhost:5001${img.url}`} alt="" className="rounded-lg aspect-square object-cover hover:scale-105 transition-transform" />
                                        </a>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Pricing items */}
                        <div className="mb-4">
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="text-sm font-semibold">Pricing Items</h4>
                                <button onClick={() => setEditItems(i => [...i, { description: "", partReplaced: "", price: 0, laborCost: 0 }])} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"><Plus className="w-3 h-3" />Add Item</button>
                            </div>
                            <div className="space-y-2 mb-3">
                                <div className="grid grid-cols-12 gap-2 text-xs text-slate-500 px-1">
                                    <span className="col-span-4">Description</span>
                                    <span className="col-span-3">Part Replaced</span>
                                    <span className="col-span-2">Parts (LKR)</span>
                                    <span className="col-span-2">Labor (LKR)</span>
                                </div>
                                {editItems.map((item, i) => (
                                    <div key={i} className="grid grid-cols-12 gap-2">
                                        <input value={item.description} onChange={e => { const n = [...editItems]; n[i].description = e.target.value; setEditItems(n); }} placeholder="e.g. Engine oil change" className="input-field text-xs col-span-4" />
                                        <input value={item.partReplaced || ""} onChange={e => { const n = [...editItems]; n[i].partReplaced = e.target.value; setEditItems(n); }} placeholder="Part name" className="input-field text-xs col-span-3" />
                                        <input type="number" value={item.price} onChange={e => { const n = [...editItems]; n[i].price = +e.target.value; setEditItems(n); }} className="input-field text-xs col-span-2" />
                                        <input type="number" value={item.laborCost} onChange={e => { const n = [...editItems]; n[i].laborCost = +e.target.value; setEditItems(n); }} className="input-field text-xs col-span-2" />
                                        <button onClick={() => setEditItems(items => items.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-400 flex items-center justify-center col-span-1"><X className="w-3.5 h-3.5" /></button>
                                    </div>
                                ))}
                            </div>
                            <div className="flex items-center justify-between bg-blue-600/10 border border-blue-500/20 rounded-xl px-4 py-3">
                                <span className="text-sm font-semibold text-slate-300">Grand Total</span>
                                <span className="text-lg font-bold text-emerald-400">LKR {total(editItems).toFixed(2)}</span>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button onClick={() => setEditQ(null)} className="btn-secondary flex-1">Cancel</button>
                            <button onClick={finalize} disabled={finalizing || editItems.filter(i => i.description).length === 0} className="btn-success flex-1">
                                <CheckCircle className="w-4 h-4 inline mr-1.5" />
                                {finalizing ? "Finalizing…" : "Create Final Quotation & Download PDF"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </DashboardLayout>
    );
}
