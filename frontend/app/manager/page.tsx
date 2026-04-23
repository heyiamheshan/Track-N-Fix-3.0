/**
 * Manager Dashboard — reviews and finalises quotations sent by the admin, manages the spare-parts
 * inventory (stock levels, ledger, low-stock alerts), views attendance overviews with PDF/CSV export,
 * accesses financial analytics (revenue, COGS, profit margin by job category), searches vehicle history,
 * and interacts with the AI voice assistant for quick lookups.
 */
"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import AIAssistant from "@/components/AIAssistant";
import { quotationsAPI, notificationsAPI, employeesAPI, attendanceAPI, inventoryAPI, analyticsAPI } from "@/lib/api";
import { formatDate, JOB_TYPE_LABELS } from "@/lib/utils";
import { Edit3, Download, Bell, Search, X, Plus, CheckCircle, FileText, DollarSign, Users, CalendarClock, AlertTriangle, Archive, Clock, TrendingUp, History, Package, Pencil, Trash2, ChevronDown, BarChart2, ShoppingCart, Percent, Activity, Car, Printer } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, Cell,
} from "recharts";

type Tab = "quotations" | "search" | "employees" | "attendance" | "inventory" | "financials";

/** Spare part record from the inventory; lowStockThreshold triggers a low-stock badge in the UI. */
interface SparePart {
    id: string; name: string; serialNumber: string; description?: string;
    boughtPrice: number; sellingPrice: number; quantity: number;
    lowStockThreshold: number; supplierName?: string; supplierDetails?: string;
    purchaseDate?: string; createdAt: string;
}

/** Blank template used to reset the Add/Edit part form. Default threshold of 5 covers most workshop scenarios. */
const EMPTY_PART: Omit<SparePart, "id" | "createdAt"> = {
    name: "", serialNumber: "", description: "", boughtPrice: 0, sellingPrice: 0,
    quantity: 0, lowStockThreshold: 5, supplierName: "", supplierDetails: "", purchaseDate: "",
};
//quotation item interface
interface QuotationItem {
    id?: string; description: string; partReplaced?: string; price: number; laborCost: number;
    sparePartId?: string; quantity?: number;
}
//job interface
interface Job {
    id: string; jobNumber: number; jobType: string; notes: string; status: string; voiceNoteUrl?: string;
    employee: { name: string }; images: { id: string; url: string; phase: string }[];
    insuranceCompany?: string; createdAt: string;
}
//quotation interface
interface Quotation {
    id: string; vehicleNumber: string; ownerName?: string; telephone?: string;
    address?: string; vehicleType?: string; color?: string; insuranceCompany?: string;
    status: string; createdAt: string; jobDetails?: string;
    job: Job; items: QuotationItem[]; totalAmount?: number;
}

interface Notification { id: string; message: string; vehicleNumber?: string; isRead: boolean; createdAt: string; }
// manager dashboard component
export default function ManagerDashboard() {
    const [tab, setTab] = useState<Tab>("quotations");

    // ── Quotation state ────────────────────────────────────────────────────────
    const [quotations, setQuotations] = useState<Quotation[]>([]);
    /** Recent = FINALIZED + CUSTOMER_NOTIFIED; used for the recent-activity summary strip. */
    const [recentQuotations, setRecentQuotations] = useState<Quotation[]>([]);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [editQ, setEditQ] = useState<Quotation | null>(null);
    const [editItems, setEditItems] = useState<QuotationItem[]>([]);

    // ── Create quotation state (manager can create quotations directly for jobs) ─
    const [createQJob, setCreateQJob] = useState<Job | null>(null);
    const [qForm, setQForm] = useState({ vehicleNumber: "", ownerName: "", address: "", telephone: "", vehicleType: "", color: "", insuranceCompany: "", jobDetails: "" });
    const [qItems, setQItems] = useState<{ description: string; partReplaced?: string; price: number; laborCost: number; quantity?: number; sparePartId?: string }[]>([{ description: "", partReplaced: "", price: 0, laborCost: 0, quantity: 1 }]);
    const [qLoading, setQLoading] = useState(false);

    const [loading, setLoading] = useState(false);
    const [finalizing, setFinalizing] = useState(false);
    const [employees, setEmployees] = useState<any[]>([]);
    const [empLoading, setEmpLoading] = useState(false);

    // ── AI Assistant ───────────────────────────────────────────────────────────
    /** Populated by the AI assistant when it looks up a vehicle; drives the vehicle-history modal. */
    const [aiVehicleModal, setAiVehicleModal] = useState<{ vehicleNumber: string; data: any } | null>(null);
    /** Hidden iframe used to trigger the browser's native print dialog for quotation PDFs. */
    const printFrameRef = useRef<HTMLIFrameElement | null>(null);

    // ── Attendance overview state ──────────────────────────────────────────────
    const [attPeriod, setAttPeriod] = useState<"weekly" | "monthly">("weekly");
    const [attDate, setAttDate] = useState("");
    const [attOverview, setAttOverview] = useState<{ period: string; startDate: string; endDate: string; overview: any[] } | null>(null);
    const [attLoading, setAttLoading] = useState(false);
    const [attHistory, setAttHistory] = useState<any[]>([]);
    const [histLoading, setHistLoading] = useState(false);
    const [histEmpFilter, setHistEmpFilter] = useState("");
    const [histStart, setHistStart] = useState("");
    const [histEnd, setHistEnd] = useState("");
    const [attArchiving, setAttArchiving] = useState(false);
    const [attEmpList, setAttEmpList] = useState<any[]>([]);

    // ── Inventory state ────────────────────────────────────────────────────────
    const [parts, setParts] = useState<SparePart[]>([]);
    const [invTotalValue, setInvTotalValue] = useState(0);
    const [invLoading, setInvLoading] = useState(false);
    const [partForm, setPartForm] = useState<Omit<SparePart, "id" | "createdAt"> | null>(null);
    const [editingPartId, setEditingPartId] = useState<string | null>(null);
    const [partSaving, setPartSaving] = useState(false);
    const [adjustReason, setAdjustReason] = useState("");
    const [invSearch, setInvSearch] = useState("");
    const [invSearchResults, setInvSearchResults] = useState<SparePart[]>([]);
    /** Index of the quotation line-item row that has an open inventory search dropdown. */
    const [invSearchOpen, setInvSearchOpen] = useState<number | null>(null);
    /** Debounce timer ref — prevents firing an inventory search on every keystroke. */
    const invSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── Stock ledger modal state ───────────────────────────────────────────────
    const [ledgerPart, setLedgerPart] = useState<SparePart | null>(null);
    const [ledgerEntries, setLedgerEntries] = useState<{ id: string; change: number; reason?: string; quotationId?: string; jobNumber?: number; createdAt: string }[]>([]);
    const [ledgerLoading, setLedgerLoading] = useState(false);

    //handle open the ledger
    const openLedger = async (p: SparePart) => {
        setLedgerPart(p);
        setLedgerLoading(true);
        try {
            const res = await inventoryAPI.ledger(p.id);
            setLedgerEntries(res.data);
        } catch { setLedgerEntries([]); }
        finally { setLedgerLoading(false); }
    };
    //handle open the inventory
    const fetchInventory = useCallback(async () => {
        setInvLoading(true);
        try {
            const res = await inventoryAPI.list();
            setParts(res.data.parts);
            setInvTotalValue(res.data.totalValue);
        } catch { /* silent */ }
        finally { setInvLoading(false); }
    }, []);

    useEffect(() => {
        if (tab === "inventory") fetchInventory();
    }, [tab, fetchInventory]);

    //handle open the add part
    const openAddPart = () => { setEditingPartId(null); setPartForm({ ...EMPTY_PART }); setAdjustReason(""); };
    //handle open the edit part
    const openEditPart = (p: SparePart) => {
        setEditingPartId(p.id);
        setPartForm({ name: p.name, serialNumber: p.serialNumber, description: p.description || "", boughtPrice: p.boughtPrice, sellingPrice: p.sellingPrice, quantity: p.quantity, lowStockThreshold: p.lowStockThreshold, supplierName: p.supplierName || "", supplierDetails: p.supplierDetails || "", purchaseDate: p.purchaseDate ? p.purchaseDate.slice(0, 10) : "" });
        setAdjustReason("");
    };
    //handle save the part
    const savePart = async () => {
        if (!partForm) return;
        setPartSaving(true);
        try {
            const payload = { ...partForm, boughtPrice: +partForm.boughtPrice, sellingPrice: +partForm.sellingPrice, quantity: +partForm.quantity, lowStockThreshold: +partForm.lowStockThreshold, adjustmentReason: adjustReason || undefined };
            if (editingPartId) {
                await inventoryAPI.update(editingPartId, payload);
            } else {
                await inventoryAPI.create(payload);
            }
            setPartForm(null);
            setEditingPartId(null);
            fetchInventory();
        } catch (e: any) {
            alert(e?.response?.data?.error || "Failed to save part");
        } finally { setPartSaving(false); }
    };
    //handle delete the part
    const deletePart = async (id: string, name: string) => {
        if (!confirm(`Delete "${name}" from inventory?`)) return;
        try { await inventoryAPI.delete(id); fetchInventory(); }
        catch { alert("Failed to delete part"); }
    };
    //handle search the inventory parts
    const searchInventoryParts = useCallback(async (q: string) => {
        if (!q.trim()) { setInvSearchResults([]); return; }
        try {
            const res = await inventoryAPI.search(q);
            setInvSearchResults(res.data);
        } catch { setInvSearchResults([]); }
    }, []);

    /** Debounced handler: fires inventory search 300 ms after the user stops typing. */
    const handleInvSearchChange = (q: string) => {
        setInvSearch(q);
        if (invSearchTimer.current) clearTimeout(invSearchTimer.current);
        invSearchTimer.current = setTimeout(() => searchInventoryParts(q), 300);
    };

    /** Populates an edit-quotation line item from a selected inventory part, linking sparePartId so stock is decremented on finalise. */
    const selectPartForItem = (idx: number, part: SparePart) => {
        const n = [...editItems];
        n[idx] = { ...n[idx], description: part.name, partReplaced: part.serialNumber, price: part.sellingPrice, sparePartId: part.id, quantity: (n[idx] as any).quantity || 1 };
        setEditItems(n);
        setInvSearchOpen(null);
        setInvSearch("");
        setInvSearchResults([]);
    };

    /** Same as selectPartForItem but targets the new-quotation form (qItems) instead of editItems. */
    const selectPartForCreateItem = (idx: number, part: SparePart) => {
        const n = [...qItems];
        n[idx] = { ...n[idx], description: part.name, partReplaced: part.serialNumber, price: part.sellingPrice, sparePartId: part.id, quantity: (n[idx] as any).quantity || 1 };
        setQItems(n);
        setInvSearchOpen(null);
        setInvSearch("");
        setInvSearchResults([]);
    };

    // ── Analytics / Financials ─────────────────────────────────────────────────
    type AnalyticsSummary = {
        period: { range: string; start: string; end: string };
        revenue: { total: number; cogs: number; grossProfit: number; profitMargin: number };
        jobs: { total: number; finalized: number; finalizationRate: number; aov: number };
        byCategory: { jobType: string; revenue: number; cogs: number; grossProfit: number; jobCount: number }[];
        inventory: {
            totalValue: number; dailyConsumption: number;
            topByValue: { id: string; name: string; quantity: number; boughtPrice: number; sellingPrice: number; stockValue: number; unitsConsumedInPeriod: number; lowStock: boolean }[];
        };
    };
    //handle open the analytics
    const [finRange, setFinRange] = useState<"daily" | "weekly" | "monthly">("monthly");
    const [finDate, setFinDate] = useState("");
    const [finData, setFinData] = useState<AnalyticsSummary | null>(null);
    const [finLoading, setFinLoading] = useState(false);

    //handle fetch the analytics
    const fetchAnalytics = useCallback(async (range: "daily" | "weekly" | "monthly", date: string) => {
        setFinLoading(true);
        try {
            const res = await analyticsAPI.summary(range, date || undefined);
            setFinData(res.data);
        } catch { /* silent */ }
        finally { setFinLoading(false); }
    }, []);

    useEffect(() => {
        if (tab === "financials") fetchAnalytics(finRange, finDate);
    }, [tab, finRange, finDate, fetchAnalytics]);

    // Search
    const [searchQ, setSearchQ] = useState("");
    const [searchType, setSearchType] = useState<"vehicleNumber" | "telephone">("vehicleNumber");
    const [searchResult, setSearchResult] = useState<{ vehicle: Record<string, string | undefined>; jobs: Job[] } | null>(null);
    const [searchError, setSearchError] = useState("");

    //handle fetch the overview
    const fetchOverview = useCallback(async (period: "weekly" | "monthly", date: string) => {
        setAttLoading(true);
        try {
            const res = await attendanceAPI.overview(period, date || undefined);
            setAttOverview(res.data);
        } catch { /* silent */ }
        finally { setAttLoading(false); }
    }, []);
    //handle fetch the history
    const fetchHistory = useCallback(async () => {
        setHistLoading(true);
        try {
            const res = await attendanceAPI.history({
                employeeId: histEmpFilter || undefined,
                startDate: histStart || undefined,
                endDate: histEnd || undefined,
            });
            setAttHistory(Array.isArray(res.data) ? res.data : []);
        } catch { /* silent */ }
        finally { setHistLoading(false); }
    }, [histEmpFilter, histStart, histEnd]);

    /**
     * Moves all active attendance records to the history archive and clears the live tables.
     * Irreversible — requires explicit user confirmation before proceeding.
     */
    const handleArchive = async () => {
        if (!confirm("Archive all current attendance records? This moves them to history and clears the active tables.")) return;
        setAttArchiving(true);
        try {
            const res = await attendanceAPI.archive();
            alert(`Archived ${res.data.archived ?? 0} records successfully.`);
            fetchOverview(attPeriod, attDate);
            attendanceAPI.managerEmployees().then(r => setAttEmpList(Array.isArray(r.data) ? r.data : [])).catch(() => { });
        } catch { alert("Archive failed. Please try again."); }
        finally { setAttArchiving(false); }
    };
    //handle status badge class
    const statusBadgeClass = (status: string) => {
        if (!status) return "bg-slate-600/20 text-slate-400";
        const s = status.toLowerCase();
        if (s.includes("checked in") || s === "overtime" || s === "present") return "bg-emerald-500/20 text-emerald-300";
        if (s === "on leave") return "bg-amber-500/20 text-amber-300";
        if (s === "on holiday" || s === "holiday") return "bg-purple-500/20 text-purple-300";
        if (s === "checked out") return "bg-slate-500/20 text-slate-300";
        if (s === "inactive") return "bg-red-500/20 text-red-300";
        if (s === "early_checkout" || s === "early checkout") return "bg-orange-500/20 text-orange-300";
        if (s === "absent" || s === "not checked in") return "bg-red-500/10 text-red-400";
        return "bg-slate-600/20 text-slate-400";
    };

    /** Generates a styled landscape PDF of the current attendance overview using jsPDF + autoTable. */
    const downloadAttPDF = () => {
        if (!attOverview) return;
        const doc = new jsPDF({ orientation: "landscape" });
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, 300, 36, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(18);
        doc.setFont("helvetica", "bold");
        doc.text("ATTENDANCE OVERVIEW REPORT", 14, 18);
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        const sd = new Date(attOverview.startDate).toLocaleDateString("en-GB");
        const ed = new Date(attOverview.endDate).toLocaleDateString("en-GB");
        doc.text(`Period: ${attOverview.period.toUpperCase()} · ${sd} — ${ed}`, 14, 28);
        doc.text(`Generated: ${new Date().toLocaleDateString("en-GB")}`, 230, 28);

        autoTable(doc, {
            startY: 44,
            head: [["Employee", "Days Present", "Leave Days", "Overtime (hrs)", "Early Checkouts", "Holidays", "Status", "Conflict"]],
            body: attOverview.overview.map(r => [
                r.employee.name,
                r.daysPresent,
                r.leaveDays,
                r.overtimeHours.toFixed(1),
                r.earlyCheckouts,
                r.holidayDays,
                r.currentStatus,
                r.conflict ? "⚠ YES" : "—",
            ]),
            styles: { fontSize: 8, cellPadding: 3 },
            headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
            alternateRowStyles: { fillColor: [248, 250, 252] },
            didParseCell: (data) => {
                if (data.section === "body" && data.column.index === 7 && data.cell.raw === "⚠ YES") {
                    data.cell.styles.textColor = [220, 38, 38];
                    data.cell.styles.fontStyle = "bold";
                }
            },
        });

        const period = attOverview.period;
        const label = period === "monthly" ? `Monthly_${sd.replace(/\//g, "-")}` : `Weekly_${sd.replace(/\//g, "-")}`;
        doc.save(`Attendance_${label}.pdf`);
    };

    /** Exports the attendance overview as a CSV file using a temporary anchor element for the download. */
    const downloadAttCSV = () => {
        if (!attOverview) return;
        const headers = ["Employee", "Email", "Days Present", "Leave Days", "Overtime (hrs)", "Early Checkouts", "Holidays", "Current Status", "Conflict"];
        const rows = attOverview.overview.map(r => [
            r.employee.name, r.employee.email, r.daysPresent, r.leaveDays,
            r.overtimeHours.toFixed(1), r.earlyCheckouts, r.holidayDays,
            r.currentStatus, r.conflict ? "YES" : "NO",
        ]);
        const csv = [headers, ...rows].map(row => row.map((v: unknown) => `"${v}"`).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `Attendance_${attOverview.period}.csv`; a.click();
        URL.revokeObjectURL(url);
    };

    // ── Initial data load ─────────────────────────────────────────────────────

    /**
     * Loads quotations and notifications in parallel on mount.
     * Manager only sees quotations that have been sent to them (SENT_TO_MANAGER)
     * or are already in a terminal delivery state (FINALIZED / CUSTOMER_NOTIFIED).
     */
    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [qRes, nRes] = await Promise.all([quotationsAPI.list(), notificationsAPI.list()]);
            setQuotations(qRes.data.filter((q: any) => ["SENT_TO_MANAGER", "FINALIZED", "CUSTOMER_NOTIFIED"].includes(q.status)));
            setRecentQuotations(qRes.data.filter((q: any) => ["FINALIZED", "CUSTOMER_NOTIFIED"].includes(q.status)));
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

    useEffect(() => {
        if (tab === "attendance") {
            fetchOverview(attPeriod, attDate);
            attendanceAPI.managerEmployees().then(r => setAttEmpList(Array.isArray(r.data) ? r.data : [])).catch(() => { });
        }
    }, [tab, attPeriod, attDate, fetchOverview]);
    //handle open the edit
    const openEdit = (q: Quotation) => {
        setEditQ(q);
        setEditItems(q.items.length > 0 ? q.items.map(i => ({ ...i })) : [{ description: "", price: 0, laborCost: 0, partReplaced: "" }]);
    };
    //handle item subtotal
    const itemSubtotal = (i: QuotationItem) => ((i.price || 0) + (i.laborCost || 0)) * (i.quantity || 1);
    //handle total
    const total = (items: QuotationItem[]) => items.reduce((s, i) => s + itemSubtotal(i), 0);

    // ── AI Assistant handlers ────────────────────────────────────────────────
    const handleAIVehicleHistory = useCallback((vehicleNumber: string, data: any) => {
        setAiVehicleModal({ vehicleNumber, data });
    }, []);
    //handle print report
    const handleAIPrintReport = useCallback((vehicleNumber: string, data: any) => {
        if (!data) return;
        const doc = new jsPDF();

        // Header
        doc.setFontSize(18);
        doc.setFont("helvetica", "bold");
        doc.text("Jayakody Auto Electrical", 105, 18, { align: "center" });
        doc.setFontSize(11);
        doc.setFont("helvetica", "normal");
        doc.text("Vehicle Service History Report", 105, 26, { align: "center" });
        doc.setFontSize(9);
        doc.text(`Generated: ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}`, 105, 32, { align: "center" });

        doc.setLineWidth(0.5);
        doc.line(14, 36, 196, 36);

        // Vehicle info
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text("Vehicle Details", 14, 43);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        const vInfo: [string, string][] = [
            ["Registration", vehicleNumber],
            ["Owner", data.ownerName || "—"],
            ["Type", data.vehicleType || "—"],
            ["Colour", data.color || "—"],
            ["Telephone", data.telephone || "—"],
        ];
        vInfo.forEach(([label, value], i) => {
            doc.text(`${label}:`, 14, 51 + i * 6);
            doc.text(value, 55, 51 + i * 6);
        });

        // Jobs table
        const jobs: any[] = data.jobs || [];
        const rows = jobs.map((job: any) => {
            const q = job.quotations?.[0];
            return [
                formatDate(job.createdAt),
                JOB_TYPE_LABELS[job.jobType as keyof typeof JOB_TYPE_LABELS] || job.jobType,
                job.employee?.name || "—",
                job.status,
                q ? `LKR ${(q.totalAmount || 0).toLocaleString()}` : "—",
            ];
        });
        //handle print report
        autoTable(doc, {
            startY: 85,
            head: [["Date", "Type", "Technician", "Status", "Amount"]],
            body: rows,
            theme: "grid",
            headStyles: { fillColor: [30, 64, 175] },
            styles: { fontSize: 8 },
        });

        doc.save(`service-history-${vehicleNumber}.pdf`);
    }, []);
    //handle finalize
    const finalize = async () => {
        if (!editQ) return;
        setFinalizing(true);
        try {
            await quotationsAPI.finalize(editQ.id, { items: editItems.filter(i => i.description), totalAmount: total(editItems) });
            const updated = { ...editQ, items: editItems, totalAmount: total(editItems), status: "FINALIZED" };
            generatePDF(updated);
            setEditQ(null); setInvSearchOpen(null); setInvSearch(""); setInvSearchResults([]);
            fetchData();
        } catch (e: any) {
            const msg = e?.response?.data?.error || "Failed to finalize quotation.";
            alert(msg);
        } finally { setFinalizing(false); }
    };
//handle generate PDF
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
        //handle generate PDF
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
            head: [["#", "Description", "Part Replaced", "Qty", "Unit Parts (LKR)", "Labor (LKR)", "Total (LKR)"]],
            body: (q.items || []).filter(i => i.description).map((item, idx) => [
                idx + 1,
                item.description,
                item.partReplaced || "—",
                item.quantity || 1,
                item.price.toFixed(2),
                item.laborCost.toFixed(2),
                itemSubtotal(item).toFixed(2),
            ]),
            foot: [["", "", "", "GRAND TOTAL", "", "", `LKR ${total(q.items || []).toFixed(2)}`]],
            styles: { fontSize: 9, cellPadding: 3 },
            headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
            footStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
            alternateRowStyles: { fillColor: [248, 250, 252] },
        });
        //handle generate PDF
        const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY || 200;
        doc.setFont("helvetica", "italic");
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 100);
        doc.text("Thank you for choosing Jayakody Auto Electrical Automobile Workshop!", 14, finalY + 12);
        doc.text("This is a computer-generated quotation.", 14, finalY + 20);

        doc.save(`Quotation_${q.vehicleNumber}_Job${q.job.jobNumber}.pdf`);
    };
//handle search
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
    //handle download service record
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
        //handle download service record
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
        //handle download service record
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
//handle create Quotation
    const submitQuotation = async () => {
        if (!createQJob) return;
        setQLoading(true);
        try {
            const res = await quotationsAPI.create({ ...qForm, jobId: createQJob.id || undefined, items: qItems.filter(i => i.description) });
            setCreateQJob(null);
            fetchData();
            generatePDF(res.data);
            alert("Quotation generated successfully and sent to your approval queue!");
        } catch {
            alert("Failed to create quotation");
        } finally {
            setQLoading(false);
        }
    };
//handle create Custom Quotation
    const handleCreateCustomQuotation = () => {
        setCreateQJob({ id: '' } as any);
        setQForm({ vehicleNumber: searchQ || "", ownerName: "", address: "", telephone: "", vehicleType: "", color: "", insuranceCompany: "", jobDetails: "" });
        setQItems([{ description: "", partReplaced: "", price: 0, laborCost: 0, quantity: 1 }]);
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
                    { key: "attendance", label: "Attendance", icon: <CalendarClock className="w-3.5 h-3.5" />, count: undefined as number | undefined },
                    { key: "inventory", label: "Inventory", icon: <Package className="w-3.5 h-3.5" />, count: parts.filter(p => p.quantity < p.lowStockThreshold).length || undefined },
                    { key: "financials", label: "Financials", icon: <BarChart2 className="w-3.5 h-3.5" />, count: undefined as number | undefined },
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
                                        <p className="text-xs text-slate-600">{emp.nicNumber || "No NIC"} · {emp.address ? emp.address.slice(0, 40) : "No Address"}</p>
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
                                        <span className={`badge ${q.status === "CUSTOMER_NOTIFIED" ? "badge-green" : q.status === "FINALIZED" ? "badge-yellow" : "badge-blue"}`}>
                                            {q.status === "CUSTOMER_NOTIFIED" ? "Customer Notified" : q.status}
                                        </span>
                                        <span className="badge badge-blue">{JOB_TYPE_LABELS[q.job.jobType]}</span>
                                    </div>
                                    <p className="text-sm text-slate-400">{q.ownerName || "Unknown owner"} · {q.telephone || "No phone"}</p>
                                    <p className="text-sm text-slate-400">{q.vehicleType} · {q.color}</p>
                                    {q.totalAmount && <p className="text-emerald-400 font-medium text-sm mt-1">LKR {q.totalAmount.toFixed(2)}</p>}
                                    <p className="text-xs text-slate-600 mt-1">{formatDate(q.createdAt)} · {q.items.length} items</p>
                                    {q.status === "CUSTOMER_NOTIFIED" && (q as any).notifiedAt && (
                                        <p className="text-xs text-emerald-500 mt-1 flex items-center gap-1">
                                            <CheckCircle className="w-3 h-3" />Notified {new Date((q as any).notifiedAt).toLocaleString("en-GB")}
                                        </p>
                                    )}
                                </div>
                                <div className="flex gap-2 ml-auto flex-wrap">
                                    {q.status === "SENT_TO_MANAGER" && (
                                        <button onClick={() => openEdit(q)} className="btn-secondary text-xs">
                                            <Edit3 className="w-3.5 h-3.5 inline mr-1" />Edit & Price
                                        </button>
                                    )}
                                    {(q.status === "FINALIZED" || q.status === "CUSTOMER_NOTIFIED") && (
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
                            <div className="flex gap-2">
                                <button onClick={handleSearch} className="btn-primary text-sm"><Search className="w-4 h-4 inline mr-1" />Search</button>
                                <button onClick={handleCreateCustomQuotation} className="btn-success text-sm whitespace-nowrap"><Plus className="w-4 h-4 inline mr-1" />Create Custom Quotation</button>
                            </div>
                        </div>
                    </div>
                    {searchError && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">{searchError}</div>}
                    {!searchResult && recentQuotations.length > 0 && (
                        <div className="card mt-2 border-blue-500/10">
                            <h3 className="text-sm font-semibold mb-3 text-slate-300 flex items-center gap-2">
                                <History className="w-4 h-4 text-blue-400" /> Recently Done Quotations
                            </h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[500px] overflow-y-auto pr-1 custom-scrollbar">
                                {recentQuotations.map((q) => (
                                    <div key={q.id} className="p-3 bg-slate-800/40 rounded-lg border border-slate-700/50 hover:border-blue-500/30 transition-colors flex justify-between items-center cursor-pointer" onClick={() => { setSearchType("vehicleNumber"); setSearchQ(q.vehicleNumber); setTimeout(handleSearch, 100); }}>
                                        <div>
                                            <p className="text-sm font-bold text-blue-400 tracking-wide">{q.vehicleNumber}</p>
                                            <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider">{formatDate(q.createdAt)}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs font-semibold text-emerald-400">Rs {q.totalAmount?.toLocaleString()}</p>
                                            <span className="badge badge-green mt-1 text-[9px] px-1.5 py-0">FINALIZED</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
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
                                        <div className="flex flex-col items-end gap-2">
                                            <span className="text-xs text-slate-500">{job.images.length} photo{job.images.length !== 1 ? "s" : ""}</span>
                                            <button onClick={() => {
                                                setCreateQJob(job);
                                                const v = searchResult.vehicle;
                                                setQForm({ vehicleNumber: v.vehicleNumber || "", ownerName: v.ownerName || "", address: v.address || "", telephone: v.telephone || "", vehicleType: v.vehicleType || "", color: v.color || "", insuranceCompany: job.insuranceCompany || "", jobDetails: job.notes || "" });
                                                setQItems([{ description: "", partReplaced: "", price: 0, laborCost: 0, quantity: 1 }]);
                                            }} className="btn-primary text-xs py-1 px-3 whitespace-nowrap">
                                                <Plus className="w-3.5 h-3.5 inline mr-1" />Add Quotation
                                            </button>
                                        </div>
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

            {/* ── ATTENDANCE ── */}
            {tab === "attendance" && (
                <div className="space-y-6 animate-fade-in">

                    {/* Controls row */}
                    <div className="card flex flex-wrap items-end gap-4">
                        <div>
                            <p className="text-xs text-slate-500 mb-1">Period</p>
                            <div className="flex gap-2">
                                <button onClick={() => setAttPeriod("weekly")} className={`tab-btn text-xs ${attPeriod === "weekly" ? "active" : ""}`}>Weekly</button>
                                <button onClick={() => setAttPeriod("monthly")} className={`tab-btn text-xs ${attPeriod === "monthly" ? "active" : ""}`}>Monthly</button>
                            </div>
                        </div>
                        <div>
                            <p className="text-xs text-slate-500 mb-1">Reference date</p>
                            <input type="date" value={attDate} onChange={e => setAttDate(e.target.value)} className="input-field text-xs" />
                        </div>
                        <div className="ml-auto flex gap-2 flex-wrap">
                            <button onClick={downloadAttPDF} disabled={!attOverview} className="btn-secondary text-xs flex items-center gap-1.5">
                                <Download className="w-3.5 h-3.5" />PDF
                            </button>
                            <button onClick={downloadAttCSV} disabled={!attOverview} className="btn-secondary text-xs flex items-center gap-1.5">
                                <Download className="w-3.5 h-3.5" />Excel (CSV)
                            </button>
                            <button onClick={handleArchive} disabled={attArchiving} className="btn-danger text-xs flex items-center gap-1.5">
                                <Archive className="w-3.5 h-3.5" />{attArchiving ? "Archiving…" : "Archive & Reset"}
                            </button>
                        </div>
                    </div>

                    {/* Today's Live Snapshot */}
                    {attEmpList.length > 0 && (
                        <div>
                            <p className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1.5">
                                <TrendingUp className="w-3.5 h-3.5" />Today's Snapshot — {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}
                            </p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                                {attEmpList.map((emp: any) => (
                                    <div key={emp.id} className="card py-2 px-3 flex items-center gap-2">
                                        <div className="w-7 h-7 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center flex-shrink-0">
                                            <span className="text-blue-400 font-bold text-xs">{emp.name[0]}</span>
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-xs font-medium text-white truncate">{emp.name}</p>
                                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${statusBadgeClass(emp.todayStatus)}`}>
                                                {emp.todayStatus}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Period label */}
                    {attOverview && (
                        <p className="text-xs text-slate-500">
                            <Clock className="w-3 h-3 inline mr-1" />
                            {new Date(attOverview.startDate).toLocaleDateString("en-GB")} — {new Date(attOverview.endDate).toLocaleDateString("en-GB")}
                        </p>
                    )}

                    {/* Conflict alert */}
                    {attOverview?.overview.some(r => r.conflict) && (
                        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 flex items-center gap-2 text-red-400 text-sm">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                            <span>
                                <strong>Conflict detected:</strong> {attOverview.overview.filter(r => r.conflict).map((r: any) => r.employee.name).join(", ")} — early checkout recorded during an approved leave period.
                            </span>
                        </div>
                    )}

                    {/* Overview table */}
                    {attLoading && <div className="text-center py-10 text-slate-500">Loading attendance data…</div>}
                    {!attLoading && attOverview && (
                        <div className="card overflow-x-auto p-0">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-700/50 text-xs text-slate-400">
                                        <th className="text-left px-4 py-3">Employee</th>
                                        <th className="text-center px-3 py-3">Present</th>
                                        <th className="text-center px-3 py-3">Leave</th>
                                        <th className="text-center px-3 py-3">OT (hrs)</th>
                                        <th className="text-center px-3 py-3">Early Out</th>
                                        <th className="text-center px-3 py-3">Holiday</th>
                                        <th className="text-center px-3 py-3">Status</th>
                                        <th className="text-center px-3 py-3">Conflict</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {attOverview.overview.map((row: any) => (
                                        <tr key={row.employee.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-7 h-7 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center flex-shrink-0">
                                                        <span className="text-blue-400 font-bold text-xs">{row.employee.name[0]}</span>
                                                    </div>
                                                    <div>
                                                        <p className="font-medium text-white text-xs">{row.employee.name}</p>
                                                        <p className="text-[10px] text-slate-500">{row.employee.email}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="text-center px-3 py-3 text-slate-200">{row.daysPresent}</td>
                                            <td className="text-center px-3 py-3 text-amber-300">{row.leaveDays}</td>
                                            <td className="text-center px-3 py-3 text-emerald-300">{row.overtimeHours.toFixed(1)}</td>
                                            <td className="text-center px-3 py-3 text-orange-300">{row.earlyCheckouts}</td>
                                            <td className="text-center px-3 py-3 text-purple-300">{row.holidayDays}</td>
                                            <td className="text-center px-3 py-3">
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusBadgeClass(row.currentStatus)}`}>
                                                    {row.currentStatus}
                                                </span>
                                            </td>
                                            <td className="text-center px-3 py-3">
                                                {row.conflict
                                                    ? <span className="flex items-center justify-center gap-1 text-red-400 text-xs font-semibold"><AlertTriangle className="w-3 h-3" />Yes</span>
                                                    : <span className="text-slate-600 text-xs">—</span>
                                                }
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {attOverview.overview.length === 0 && (
                                <div className="text-center py-10 text-slate-500 text-sm">No employee data found for this period.</div>
                            )}
                        </div>
                    )}

                    {/* Summary cards */}
                    {!attLoading && attOverview && attOverview.overview.length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {[
                                { label: "Avg. Present", value: (attOverview.overview.reduce((s: number, r: any) => s + r.daysPresent, 0) / attOverview.overview.length).toFixed(1), icon: <TrendingUp className="w-4 h-4 text-emerald-400" />, color: "text-emerald-400" },
                                { label: "Total Leave Days", value: attOverview.overview.reduce((s: number, r: any) => s + r.leaveDays, 0), icon: <CalendarClock className="w-4 h-4 text-amber-400" />, color: "text-amber-400" },
                                { label: "Total OT Hours", value: attOverview.overview.reduce((s: number, r: any) => s + r.overtimeHours, 0).toFixed(1), icon: <Clock className="w-4 h-4 text-blue-400" />, color: "text-blue-400" },
                                { label: "Early Checkouts", value: attOverview.overview.reduce((s: number, r: any) => s + r.earlyCheckouts, 0), icon: <AlertTriangle className="w-4 h-4 text-orange-400" />, color: "text-orange-400" },
                            ].map(c => (
                                <div key={c.label} className="card flex items-center gap-3">
                                    {c.icon}
                                    <div>
                                        <p className="text-xs text-slate-500">{c.label}</p>
                                        <p className={`text-lg font-bold ${c.color}`}>{c.value}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Attendance History Browser */}
                    <div className="card space-y-4">
                        <div className="flex items-center gap-2 mb-1">
                            <History className="w-4 h-4 text-slate-400" />
                            <h3 className="text-sm font-semibold text-slate-200">Attendance History</h3>
                        </div>
                        <div className="flex flex-wrap gap-3 items-end">
                            <div>
                                <p className="text-xs text-slate-500 mb-1">Employee</p>
                                <select value={histEmpFilter} onChange={e => setHistEmpFilter(e.target.value)} className="input-field text-xs">
                                    <option value="">All Employees</option>
                                    {attEmpList.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <p className="text-xs text-slate-500 mb-1">From</p>
                                <input type="date" value={histStart} onChange={e => setHistStart(e.target.value)} className="input-field text-xs" />
                            </div>
                            <div>
                                <p className="text-xs text-slate-500 mb-1">To</p>
                                <input type="date" value={histEnd} onChange={e => setHistEnd(e.target.value)} className="input-field text-xs" />
                            </div>
                            <button onClick={fetchHistory} disabled={histLoading} className="btn-primary text-xs">
                                <Search className="w-3.5 h-3.5 inline mr-1" />{histLoading ? "Loading…" : "Search"}
                            </button>
                        </div>

                        {histLoading && <div className="text-center py-6 text-slate-500 text-sm">Loading history…</div>}
                        {!histLoading && attHistory.length === 0 && (
                            <div className="text-center py-6 text-slate-600 text-sm">Search above to browse archived attendance records.</div>
                        )}
                        {!histLoading && attHistory.length > 0 && (
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="border-b border-slate-700/50 text-slate-400">
                                            <th className="text-left px-3 py-2">Employee</th>
                                            <th className="text-left px-3 py-2">Date</th>
                                            <th className="text-left px-3 py-2">Status</th>
                                            <th className="text-left px-3 py-2">Check In</th>
                                            <th className="text-left px-3 py-2">Check Out</th>
                                            <th className="text-left px-3 py-2">OT (hrs)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {attHistory.map((h: any) => {
                                            const otHours = h.overtimeStart && h.overtimeEnd
                                                ? ((new Date(h.overtimeEnd).getTime() - new Date(h.overtimeStart).getTime()) / 3600000).toFixed(1)
                                                : null;
                                            return (
                                                <tr key={h.id} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                                                    <td className="px-3 py-2 text-slate-200">{h.employee?.name || h.employeeName || "—"}</td>
                                                    <td className="px-3 py-2 text-slate-400">{new Date(h.date).toLocaleDateString("en-GB")}</td>
                                                    <td className="px-3 py-2">
                                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusBadgeClass(h.attendanceStatus || "")}`}>
                                                            {h.attendanceStatus || "—"}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-2 text-slate-400">{h.checkInTime ? new Date(h.checkInTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                                                    <td className="px-3 py-2 text-slate-400">{h.checkOutTime ? new Date(h.checkOutTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                                                    <td className="px-3 py-2 text-emerald-300">{otHours ? `${otHours}h` : "—"}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── INVENTORY ── */}
            {tab === "inventory" && (
                <div className="space-y-6 animate-fade-in">
                    {/* Summary cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="card flex items-center gap-3">
                            <Package className="w-5 h-5 text-blue-400 flex-shrink-0" />
                            <div>
                                <p className="text-xs text-slate-500">Total Parts</p>
                                <p className="text-lg font-bold text-white">{parts.length}</p>
                            </div>
                        </div>
                        <div className="card flex items-center gap-3">
                            <DollarSign className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                            <div>
                                <p className="text-xs text-slate-500">Total Asset Value</p>
                                <p className="text-lg font-bold text-emerald-400">LKR {invTotalValue.toLocaleString("en-LK", { minimumFractionDigits: 2 })}</p>
                            </div>
                        </div>
                        <div className="card flex items-center gap-3">
                            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                            <div>
                                <p className="text-xs text-slate-500">Low-Stock Items</p>
                                <p className="text-lg font-bold text-amber-400">{parts.filter(p => p.quantity < p.lowStockThreshold).length}</p>
                            </div>
                        </div>
                    </div>

                    {/* Low-stock alert */}
                    {parts.filter(p => p.quantity < p.lowStockThreshold).length > 0 && (
                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex items-center gap-2 text-amber-300 text-sm">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                            <span><strong>Low stock:</strong> {parts.filter(p => p.quantity < p.lowStockThreshold).map(p => `${p.name} (${p.quantity} left)`).join(" · ")}</span>
                        </div>
                    )}

                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-200">Spare Parts Vault</h3>
                        <button onClick={openAddPart} className="btn-primary text-xs flex items-center gap-1.5">
                            <Plus className="w-3.5 h-3.5" />Add Part
                        </button>
                    </div>

                    {invLoading && <div className="text-center py-10 text-slate-500">Loading inventory…</div>}
                    {!invLoading && parts.length === 0 && (
                        <div className="card text-center py-10 text-slate-500">
                            <Package className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                            No parts registered yet. Click "Add Part" to begin.
                        </div>
                    )}

                    {!invLoading && parts.length > 0 && (
                        <div className="card overflow-x-auto p-0">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-700/50 text-xs text-slate-400">
                                        <th className="text-left px-4 py-3">Part</th>
                                        <th className="text-left px-3 py-3">Serial No.</th>
                                        <th className="text-right px-3 py-3">Qty</th>
                                        <th className="text-right px-3 py-3">Bought (LKR)</th>
                                        <th className="text-right px-3 py-3">Sell (LKR)</th>
                                        <th className="text-right px-3 py-3">Margin</th>
                                        <th className="text-left px-3 py-3">Supplier</th>
                                        <th className="text-center px-3 py-3">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {parts.map(p => {
                                        const margin = p.sellingPrice > 0 ? ((p.sellingPrice - p.boughtPrice) / p.sellingPrice * 100).toFixed(1) : "0.0";
                                        const isLow = p.quantity < p.lowStockThreshold;
                                        return (
                                            <tr key={p.id} className={`border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors ${isLow ? "bg-amber-500/5" : ""}`}>
                                                <td className="px-4 py-3">
                                                    <p className="font-medium text-white text-xs">{p.name}</p>
                                                    {p.description && <p className="text-[10px] text-slate-500 truncate max-w-[140px]">{p.description}</p>}
                                                </td>
                                                <td className="px-3 py-3 text-slate-400 text-xs font-mono">{p.serialNumber}</td>
                                                <td className={`px-3 py-3 text-right font-semibold text-xs ${isLow ? "text-amber-400" : "text-slate-200"}`}>
                                                    {p.quantity}
                                                    {isLow && <span className="ml-1 text-[9px] bg-amber-500/20 text-amber-300 px-1 py-0.5 rounded">LOW</span>}
                                                </td>
                                                <td className="px-3 py-3 text-right text-slate-300 text-xs">{p.boughtPrice.toFixed(2)}</td>
                                                <td className="px-3 py-3 text-right text-emerald-300 text-xs">{p.sellingPrice.toFixed(2)}</td>
                                                <td className="px-3 py-3 text-right text-blue-300 text-xs">{margin}%</td>
                                                <td className="px-3 py-3 text-slate-400 text-xs">{p.supplierName || "—"}</td>
                                                <td className="px-3 py-3 text-center">
                                                    <div className="flex items-center justify-center gap-2">
                                                        <button onClick={() => openLedger(p)} title="Stock ledger" className="text-slate-400 hover:text-emerald-400 transition-colors"><History className="w-3.5 h-3.5" /></button>
                                                        <button onClick={() => openEditPart(p)} title="Edit" className="text-slate-400 hover:text-blue-400 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                                                        <button onClick={() => deletePart(p.id, p.name)} title="Delete" className="text-slate-400 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Profit Analysis */}
                    {!invLoading && parts.length > 0 && (
                        <div className="card space-y-3">
                            <div className="flex items-center gap-2">
                                <TrendingUp className="w-4 h-4 text-blue-400" />
                                <h3 className="text-sm font-semibold text-slate-200">Profit Margin Analysis</h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="border-b border-slate-700/50 text-slate-400">
                                            <th className="text-left px-3 py-2">Part</th>
                                            <th className="text-right px-3 py-2">Bought (LKR)</th>
                                            <th className="text-right px-3 py-2">Sell (LKR)</th>
                                            <th className="text-right px-3 py-2">Profit / Unit</th>
                                            <th className="text-right px-3 py-2">Margin %</th>
                                            <th className="text-right px-3 py-2">Stock Value</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[...parts].sort((a, b) => {
                                            const ma = a.sellingPrice > 0 ? (a.sellingPrice - a.boughtPrice) / a.sellingPrice : 0;
                                            const mb = b.sellingPrice > 0 ? (b.sellingPrice - b.boughtPrice) / b.sellingPrice : 0;
                                            return mb - ma;
                                        }).map(p => {
                                            const profitPerUnit = p.sellingPrice - p.boughtPrice;
                                            const margin = p.sellingPrice > 0 ? (profitPerUnit / p.sellingPrice * 100) : 0;
                                            const stockValue = p.boughtPrice * p.quantity;
                                            return (
                                                <tr key={p.id} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                                                    <td className="px-3 py-2 text-slate-200">{p.name}</td>
                                                    <td className="px-3 py-2 text-right text-slate-400">{p.boughtPrice.toFixed(2)}</td>
                                                    <td className="px-3 py-2 text-right text-emerald-300">{p.sellingPrice.toFixed(2)}</td>
                                                    <td className={`px-3 py-2 text-right font-medium ${profitPerUnit >= 0 ? "text-emerald-300" : "text-red-400"}`}>
                                                        {profitPerUnit >= 0 ? "+" : ""}{profitPerUnit.toFixed(2)}
                                                    </td>
                                                    <td className={`px-3 py-2 text-right font-semibold ${margin >= 30 ? "text-emerald-400" : margin >= 10 ? "text-amber-400" : "text-red-400"}`}>
                                                        {margin.toFixed(1)}%
                                                    </td>
                                                    <td className="px-3 py-2 text-right text-slate-300">{stockValue.toFixed(2)}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot>
                                        <tr className="bg-slate-800/50 font-semibold">
                                            <td className="px-3 py-2 text-slate-300" colSpan={5}>Total Inventory Cost</td>
                                            <td className="px-3 py-2 text-right text-emerald-400">{parts.reduce((s, p) => s + p.boughtPrice * p.quantity, 0).toFixed(2)}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── FINANCIALS ── */}
            {tab === "financials" && (
                <div className="space-y-6 animate-fade-in">
                    {/* Controls */}
                    <div className="card flex flex-wrap items-end gap-4">
                        <div>
                            <p className="text-xs text-slate-500 mb-1">Period</p>
                            <div className="flex gap-2">
                                {(["daily", "weekly", "monthly"] as const).map(r => (
                                    <button key={r} onClick={() => setFinRange(r)} className={`tab-btn text-xs ${finRange === r ? "active" : ""}`}>{r.charAt(0).toUpperCase() + r.slice(1)}</button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <p className="text-xs text-slate-500 mb-1">Reference date</p>
                            <input type="date" value={finDate} onChange={e => setFinDate(e.target.value)} className="input-field text-xs" />
                        </div>
                        <button onClick={() => fetchAnalytics(finRange, finDate)} disabled={finLoading} className="btn-primary text-xs ml-auto">
                            {finLoading ? "Loading…" : "Refresh"}
                        </button>
                    </div>

                    {finLoading && <div className="text-center py-16 text-slate-500">Calculating financials…</div>}

                    {!finLoading && finData && (() => {
                        const { revenue, jobs, byCategory, inventory } = finData;
                        const periodLabel = `${new Date(finData.period.start).toLocaleDateString("en-GB")} — ${new Date(finData.period.end).toLocaleDateString("en-GB")}`;

                        const KPI_CARDS = [
                            { label: "Gross Revenue", value: `LKR ${revenue.total.toLocaleString("en-LK", { minimumFractionDigits: 2 })}`, icon: <DollarSign className="w-5 h-5 text-emerald-400" />, color: "text-emerald-400" },
                            { label: "COGS", value: `LKR ${revenue.cogs.toLocaleString("en-LK", { minimumFractionDigits: 2 })}`, icon: <ShoppingCart className="w-5 h-5 text-red-400" />, color: "text-red-400" },
                            { label: "Gross Profit", value: `LKR ${revenue.grossProfit.toLocaleString("en-LK", { minimumFractionDigits: 2 })}`, icon: <TrendingUp className="w-5 h-5 text-blue-400" />, color: revenue.grossProfit >= 0 ? "text-blue-400" : "text-red-400" },
                            { label: "Profit Margin", value: `${revenue.profitMargin.toFixed(1)}%`, icon: <Percent className="w-5 h-5 text-purple-400" />, color: revenue.profitMargin >= 30 ? "text-emerald-400" : revenue.profitMargin >= 10 ? "text-amber-400" : "text-red-400" },
                            { label: "Avg. Order Value", value: `LKR ${jobs.aov.toLocaleString("en-LK", { minimumFractionDigits: 2 })}`, icon: <Activity className="w-5 h-5 text-cyan-400" />, color: "text-cyan-400" },
                            { label: "Finalization Rate", value: `${jobs.finalizationRate.toFixed(1)}%`, icon: <CheckCircle className="w-5 h-5 text-amber-400" />, color: "text-amber-400" },
                            { label: "Jobs (period)", value: jobs.total, icon: <FileText className="w-5 h-5 text-slate-400" />, color: "text-slate-200" },
                            { label: "Finalized Jobs", value: jobs.finalized, icon: <CheckCircle className="w-5 h-5 text-emerald-400" />, color: "text-emerald-400" },
                        ];

                        const chartData = byCategory.map(c => ({
                            name: JOB_TYPE_LABELS[c.jobType] || c.jobType,
                            Revenue: parseFloat(c.revenue.toFixed(2)),
                            COGS: parseFloat(c.cogs.toFixed(2)),
                            "Gross Profit": parseFloat(c.grossProfit.toFixed(2)),
                            Jobs: c.jobCount,
                        }));

                        const CATEGORY_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444"];

                        return (
                            <>
                                <p className="text-xs text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" />{periodLabel}</p>

                                {/* KPI Cards */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    {KPI_CARDS.map(c => (
                                        <div key={c.label} className="card flex items-center gap-3">
                                            {c.icon}
                                            <div className="min-w-0">
                                                <p className="text-xs text-slate-500 truncate">{c.label}</p>
                                                <p className={`text-base font-bold truncate ${c.color}`}>{c.value}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Revenue & Profit breakdown bar chart */}
                                {chartData.length > 0 && (
                                    <div className="card">
                                        <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
                                            <BarChart2 className="w-4 h-4 text-blue-400" />Revenue by Service Category
                                        </h3>
                                        <ResponsiveContainer width="100%" height={260}>
                                            <BarChart data={chartData} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                                                <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                                                <Tooltip
                                                    contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
                                                    labelStyle={{ color: "#e2e8f0" }}
                                                    formatter={(v) => typeof v === "number" ? `LKR ${v.toLocaleString("en-LK")}` : v}
                                                />
                                                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                                                <Bar dataKey="Revenue" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                                                <Bar dataKey="COGS" fill="#ef4444" radius={[3, 3, 0, 0]} />
                                                <Bar dataKey="Gross Profit" fill="#10b981" radius={[3, 3, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}

                                {/* Job Volume vs Financial Value — per category detail table */}
                                {byCategory.length > 0 && (
                                    <div className="card">
                                        <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
                                            <Activity className="w-4 h-4 text-purple-400" />Service Category Performance
                                        </h3>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-xs">
                                                <thead>
                                                    <tr className="border-b border-slate-700/50 text-slate-400">
                                                        <th className="text-left px-3 py-2">Category</th>
                                                        <th className="text-right px-3 py-2">Jobs</th>
                                                        <th className="text-right px-3 py-2">Revenue (LKR)</th>
                                                        <th className="text-right px-3 py-2">COGS (LKR)</th>
                                                        <th className="text-right px-3 py-2">Gross Profit (LKR)</th>
                                                        <th className="text-right px-3 py-2">Margin %</th>
                                                        <th className="text-right px-3 py-2">Avg / Job (LKR)</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {[...byCategory].sort((a, b) => b.revenue - a.revenue).map((c, idx) => {
                                                        const margin = c.revenue > 0 ? (c.grossProfit / c.revenue * 100) : 0;
                                                        const avgPerJob = c.jobCount > 0 ? c.revenue / c.jobCount : 0;
                                                        return (
                                                            <tr key={c.jobType} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                                                                <td className="px-3 py-2">
                                                                    <span className="flex items-center gap-2">
                                                                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: CATEGORY_COLORS[idx % CATEGORY_COLORS.length] }} />
                                                                        <span className="font-medium text-white">{JOB_TYPE_LABELS[c.jobType] || c.jobType}</span>
                                                                    </span>
                                                                </td>
                                                                <td className="px-3 py-2 text-right text-slate-300">{c.jobCount}</td>
                                                                <td className="px-3 py-2 text-right text-emerald-300">{c.revenue.toLocaleString("en-LK", { minimumFractionDigits: 2 })}</td>
                                                                <td className="px-3 py-2 text-right text-red-400">{c.cogs.toLocaleString("en-LK", { minimumFractionDigits: 2 })}</td>
                                                                <td className={`px-3 py-2 text-right font-semibold ${c.grossProfit >= 0 ? "text-blue-300" : "text-red-400"}`}>{c.grossProfit.toLocaleString("en-LK", { minimumFractionDigits: 2 })}</td>
                                                                <td className={`px-3 py-2 text-right font-semibold ${margin >= 30 ? "text-emerald-400" : margin >= 10 ? "text-amber-400" : "text-red-400"}`}>{margin.toFixed(1)}%</td>
                                                                <td className="px-3 py-2 text-right text-slate-300">{avgPerJob.toLocaleString("en-LK", { minimumFractionDigits: 2 })}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}

                                {/* Inventory Financial Status */}
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <div className="card flex items-center gap-3">
                                        <Package className="w-5 h-5 text-blue-400 flex-shrink-0" />
                                        <div>
                                            <p className="text-xs text-slate-500">Total Inventory Value</p>
                                            <p className="text-base font-bold text-blue-400">LKR {inventory.totalValue.toLocaleString("en-LK", { minimumFractionDigits: 2 })}</p>
                                            <p className="text-[10px] text-slate-600">Capital tied up in stock</p>
                                        </div>
                                    </div>
                                    <div className="card flex items-center gap-3">
                                        <ShoppingCart className="w-5 h-5 text-amber-400 flex-shrink-0" />
                                        <div>
                                            <p className="text-xs text-slate-500">Today's Stock Consumption</p>
                                            <p className="text-base font-bold text-amber-400">LKR {inventory.dailyConsumption.toLocaleString("en-LK", { minimumFractionDigits: 2 })}</p>
                                            <p className="text-[10px] text-slate-600">Parts cost used today</p>
                                        </div>
                                    </div>
                                    <div className="card flex items-center gap-3">
                                        <TrendingUp className="w-5 h-5 text-purple-400 flex-shrink-0" />
                                        <div>
                                            <p className="text-xs text-slate-500">Inv. to Revenue Ratio</p>
                                            <p className="text-base font-bold text-purple-400">
                                                {revenue.total > 0 ? `${(inventory.totalValue / revenue.total * 100).toFixed(1)}%` : "—"}
                                            </p>
                                            <p className="text-[10px] text-slate-600">Stock value vs period revenue</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Liquidity / Top parts by capital */}
                                {inventory.topByValue.length > 0 && (
                                    <div className="card">
                                        <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
                                            <DollarSign className="w-4 h-4 text-emerald-400" />High-Value Inventory — Liquidity Tracker
                                        </h3>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-xs">
                                                <thead>
                                                    <tr className="border-b border-slate-700/50 text-slate-400">
                                                        <th className="text-left px-3 py-2">Part</th>
                                                        <th className="text-right px-3 py-2">Stock</th>
                                                        <th className="text-right px-3 py-2">Unit Cost</th>
                                                        <th className="text-right px-3 py-2">Stock Value</th>
                                                        <th className="text-right px-3 py-2">Used (period)</th>
                                                        <th className="text-right px-3 py-2">Sell Price</th>
                                                        <th className="text-center px-3 py-2">Status</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {inventory.topByValue.map(p => (
                                                        <tr key={p.id} className={`border-b border-slate-800/40 hover:bg-slate-800/20 ${p.lowStock ? "bg-amber-500/5" : ""}`}>
                                                            <td className="px-3 py-2 font-medium text-white">{p.name}</td>
                                                            <td className={`px-3 py-2 text-right ${p.lowStock ? "text-amber-400 font-semibold" : "text-slate-300"}`}>{p.quantity}</td>
                                                            <td className="px-3 py-2 text-right text-slate-400">{p.boughtPrice.toFixed(2)}</td>
                                                            <td className="px-3 py-2 text-right text-blue-300 font-semibold">{p.stockValue.toLocaleString("en-LK", { minimumFractionDigits: 2 })}</td>
                                                            <td className="px-3 py-2 text-right text-slate-300">{p.unitsConsumedInPeriod > 0 ? `×${p.unitsConsumedInPeriod}` : "—"}</td>
                                                            <td className="px-3 py-2 text-right text-emerald-300">{p.sellingPrice.toFixed(2)}</td>
                                                            <td className="px-3 py-2 text-center">
                                                                {p.lowStock
                                                                    ? <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/20 text-amber-300 font-medium">Low Stock</span>
                                                                    : <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300">OK</span>}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}

                                {byCategory.length === 0 && revenue.total === 0 && (
                                    <div className="card text-center py-12 text-slate-500">
                                        <BarChart2 className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                                        No finalized quotations found for this period.
                                    </div>
                                )}
                            </>
                        );
                    })()}
                </div>
            )}

            {/* ── STOCK LEDGER MODAL ── */}
            {ledgerPart && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="card max-w-2xl w-full max-h-[85vh] overflow-y-auto animate-fade-in">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="font-semibold text-lg">Stock Ledger</h3>
                                <p className="text-sm text-slate-400">{ledgerPart.name} · <span className="font-mono text-xs">{ledgerPart.serialNumber}</span></p>
                            </div>
                            <button onClick={() => setLedgerPart(null)}><X className="w-5 h-5 text-slate-500" /></button>
                        </div>
                        <div className="flex items-center gap-4 mb-4 bg-slate-800/40 rounded-xl px-4 py-3 text-sm">
                            <div><p className="text-xs text-slate-500">Current Stock</p><p className="font-bold text-white">{ledgerPart.quantity}</p></div>
                            <div><p className="text-xs text-slate-500">Threshold</p><p className="font-bold text-amber-400">{ledgerPart.lowStockThreshold}</p></div>
                            <div><p className="text-xs text-slate-500">Bought Price</p><p className="font-bold text-slate-300">LKR {ledgerPart.boughtPrice.toFixed(2)}</p></div>
                            <div><p className="text-xs text-slate-500">Sell Price</p><p className="font-bold text-emerald-400">LKR {ledgerPart.sellingPrice.toFixed(2)}</p></div>
                        </div>
                        {ledgerLoading && <div className="text-center py-8 text-slate-500 text-sm">Loading ledger…</div>}
                        {!ledgerLoading && ledgerEntries.length === 0 && (
                            <div className="text-center py-8 text-slate-600 text-sm">No ledger entries yet. Stock changes will appear here.</div>
                        )}
                        {!ledgerLoading && ledgerEntries.length > 0 && (
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="border-b border-slate-700/50 text-slate-400">
                                            <th className="text-left px-3 py-2">Date</th>
                                            <th className="text-center px-3 py-2">Change</th>
                                            <th className="text-left px-3 py-2">Reason</th>
                                            <th className="text-center px-3 py-2">Job #</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ledgerEntries.map(e => (
                                            <tr key={e.id} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                                                <td className="px-3 py-2 text-slate-400">{new Date(e.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                                                <td className="px-3 py-2 text-center">
                                                    <span className={`font-bold ${e.change > 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                        {e.change > 0 ? "+" : ""}{e.change}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2 text-slate-300">{e.reason || "—"}</td>
                                                <td className="px-3 py-2 text-center text-slate-400">{e.jobNumber ? `#${e.jobNumber}` : "—"}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        <div className="mt-4 flex justify-end">
                            <button onClick={() => setLedgerPart(null)} className="btn-secondary text-sm">Close</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── ADD / EDIT PART MODAL ── */}
            {partForm !== null && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="card max-w-lg w-full max-h-[90vh] overflow-y-auto animate-fade-in">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-semibold text-lg">{editingPartId ? "Edit Part" : "Add New Part"}</h3>
                            <button onClick={() => setPartForm(null)}><X className="w-5 h-5 text-slate-500" /></button>
                        </div>
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <p className="text-xs text-slate-500 mb-1">Part Name *</p>
                                    <input value={partForm.name} onChange={e => setPartForm(f => f && ({ ...f, name: e.target.value }))} className="input-field text-sm w-full" placeholder="e.g. Brake Pad" />
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500 mb-1">Serial / Part No. *</p>
                                    <input value={partForm.serialNumber} onChange={e => setPartForm(f => f && ({ ...f, serialNumber: e.target.value }))} className="input-field text-sm w-full" placeholder="e.g. BP-4421" />
                                </div>
                            </div>
                            <div>
                                <p className="text-xs text-slate-500 mb-1">Description</p>
                                <input value={partForm.description || ""} onChange={e => setPartForm(f => f && ({ ...f, description: e.target.value }))} className="input-field text-sm w-full" placeholder="Optional description" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <p className="text-xs text-slate-500 mb-1">Bought Price (LKR) *</p>
                                    <input type="number" min="0" value={partForm.boughtPrice} onChange={e => setPartForm(f => f && ({ ...f, boughtPrice: +e.target.value }))} className="input-field text-sm w-full" />
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500 mb-1">Selling Price (LKR) *</p>
                                    <input type="number" min="0" value={partForm.sellingPrice} onChange={e => setPartForm(f => f && ({ ...f, sellingPrice: +e.target.value }))} className="input-field text-sm w-full" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <p className="text-xs text-slate-500 mb-1">Quantity in Stock *</p>
                                    <input type="number" min="0" value={partForm.quantity} onChange={e => setPartForm(f => f && ({ ...f, quantity: +e.target.value }))} className="input-field text-sm w-full" />
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500 mb-1">Low-Stock Threshold</p>
                                    <input type="number" min="0" value={partForm.lowStockThreshold} onChange={e => setPartForm(f => f && ({ ...f, lowStockThreshold: +e.target.value }))} className="input-field text-sm w-full" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <p className="text-xs text-slate-500 mb-1">Supplier Name</p>
                                    <input value={partForm.supplierName || ""} onChange={e => setPartForm(f => f && ({ ...f, supplierName: e.target.value }))} className="input-field text-sm w-full" />
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500 mb-1">Date of Purchase</p>
                                    <input type="date" value={partForm.purchaseDate || ""} onChange={e => setPartForm(f => f && ({ ...f, purchaseDate: e.target.value }))} className="input-field text-sm w-full" />
                                </div>
                            </div>
                            <div>
                                <p className="text-xs text-slate-500 mb-1">Supplier Details</p>
                                <input value={partForm.supplierDetails || ""} onChange={e => setPartForm(f => f && ({ ...f, supplierDetails: e.target.value }))} className="input-field text-sm w-full" placeholder="Contact, address, etc." />
                            </div>
                            {editingPartId && (
                                <div>
                                    <p className="text-xs text-slate-500 mb-1">Reason for Stock Adjustment (required if qty changed)</p>
                                    <input value={adjustReason} onChange={e => setAdjustReason(e.target.value)} className="input-field text-sm w-full" placeholder="e.g. Damaged goods removed" />
                                </div>
                            )}
                            {partForm.boughtPrice > 0 && partForm.sellingPrice > 0 && (
                                <div className="bg-blue-600/10 border border-blue-500/20 rounded-xl px-4 py-2 text-xs text-slate-300 flex justify-between">
                                    <span>Profit margin</span>
                                    <span className="font-semibold text-blue-300">{((partForm.sellingPrice - partForm.boughtPrice) / partForm.sellingPrice * 100).toFixed(1)}%</span>
                                </div>
                            )}
                        </div>
                        <div className="flex gap-3 mt-5">
                            <button onClick={() => setPartForm(null)} className="btn-secondary flex-1">Cancel</button>
                            <button onClick={savePart} disabled={partSaving || !partForm.name || !partForm.serialNumber} className="btn-success flex-1">
                                {partSaving ? "Saving…" : editingPartId ? "Save Changes" : "Add to Inventory"}
                            </button>
                        </div>
                    </div>
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
                            <button onClick={() => { setEditQ(null); setInvSearchOpen(null); setInvSearch(""); setInvSearchResults([]); }}><X className="w-5 h-5 text-slate-500" /></button>
                        </div>

                        {/* Vehicle & job info (read-only) */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm mb-4">
                            {[["Owner", editQ.ownerName], ["Phone", editQ.telephone], ["Type", editQ.vehicleType], ["Color", editQ.color], ["Address", editQ.address], ["Insurance", editQ.insuranceCompany]].map(([l, v]) => (
                                <div key={l}><p className="text-xs text-slate-500">{l}</p><p className="text-slate-200">{v || "—"}</p></div>
                            ))}
                        </div>

                        {/* Employee notes (read-only) */}
                        {(editQ.job.notes || editQ.job.voiceNoteUrl) && (
                            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 mb-6">
                                {editQ.job.notes && (
                                    <>
                                        <p className="text-xs text-amber-400 font-medium mb-1">Work Notes (from employee)</p>
                                        <p className="text-sm text-slate-300 whitespace-pre-wrap">{editQ.job.notes}</p>
                                    </>
                                )}
                                {editQ.job.voiceNoteUrl && (
                                    <div className={`mt-3 pt-3 ${editQ.job.notes ? "border-t border-amber-500/10" : ""}`}>
                                        <p className="text-xs text-amber-400 font-medium mb-2">Voice Note</p>
                                        <audio className="w-full h-8" controls preload="none" src={`${process.env.NEXT_PUBLIC_API_URL?.replace('/api', '')}${editQ.job.voiceNoteUrl}`} />
                                    </div>
                                )}
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
                                <button onClick={() => setEditItems(i => [...i, { description: "", partReplaced: "", price: 0, laborCost: 0, quantity: 1 }])} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"><Plus className="w-3 h-3" />Add Item</button>
                            </div>
                            <div className="space-y-3 mb-3">
                                <div className="grid grid-cols-12 gap-2 text-xs text-slate-500 px-1">
                                    <span className="col-span-4">Description</span>
                                    <span className="col-span-2">Part / Serial</span>
                                    <span className="col-span-1">Qty</span>
                                    <span className="col-span-2">Parts (LKR)</span>
                                    <span className="col-span-2">Labor (LKR)</span>
                                </div>
                                {editItems.map((item, i) => (
                                    <div key={i} className="space-y-1">
                                        <div className="grid grid-cols-12 gap-2">
                                            <input value={item.description} onChange={e => { const n = [...editItems]; n[i].description = e.target.value; setEditItems(n); }} placeholder="e.g. Engine oil change" className="input-field text-xs col-span-4" />
                                            <input value={item.partReplaced || ""} onChange={e => { const n = [...editItems]; n[i].partReplaced = e.target.value; setEditItems(n); }} placeholder="Part name" className="input-field text-xs col-span-2" />
                                            <input type="number" min="1" value={item.quantity ?? 1} onChange={e => { const n = [...editItems]; n[i].quantity = +e.target.value; setEditItems(n); }} className="input-field text-xs col-span-1" />
                                            <input type="number" value={item.price} onChange={e => { const n = [...editItems]; n[i].price = +e.target.value; setEditItems(n); }} className="input-field text-xs col-span-2" />
                                            <input type="number" value={item.laborCost} onChange={e => { const n = [...editItems]; n[i].laborCost = +e.target.value; setEditItems(n); }} className="input-field text-xs col-span-2" />
                                            <button onClick={() => setEditItems(items => items.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-400 flex items-center justify-center col-span-1"><X className="w-3.5 h-3.5" /></button>
                                        </div>
                                        {/* Inventory part search for this row */}
                                        <div className="relative col-span-12 pl-1">
                                            {invSearchOpen === i ? (
                                                <div className="flex gap-2 items-center">
                                                    <input
                                                        autoFocus
                                                        value={invSearch}
                                                        onChange={e => handleInvSearchChange(e.target.value)}
                                                        placeholder="Search inventory by name or serial…"
                                                        className="input-field text-xs flex-1"
                                                    />
                                                    <button onClick={() => { setInvSearchOpen(null); setInvSearch(""); setInvSearchResults([]); }} className="text-xs text-slate-500 hover:text-red-400"><X className="w-3 h-3" /></button>
                                                </div>
                                            ) : (
                                                <button onClick={() => { setInvSearchOpen(i); setInvSearch(""); setInvSearchResults([]); }} className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1">
                                                    <Package className="w-3 h-3" />
                                                    {item.sparePartId ? <span className="text-emerald-400">Linked to inventory</span> : "Pick from inventory"}
                                                    <ChevronDown className="w-3 h-3" />
                                                </button>
                                            )}
                                            {invSearchOpen === i && invSearchResults.length > 0 && (
                                                <div className="absolute z-10 top-7 left-0 right-0 bg-slate-800 border border-slate-600 rounded-xl shadow-xl overflow-hidden">
                                                    {invSearchResults.map(p => (
                                                        <button key={p.id} onClick={() => selectPartForItem(i, p)} className="w-full text-left px-3 py-2 hover:bg-slate-700 transition-colors border-b border-slate-700/50 last:border-0">
                                                            <div className="flex items-center justify-between gap-3">
                                                                <div>
                                                                    <p className="text-xs font-medium text-white">{p.name}</p>
                                                                    <p className="text-[10px] text-slate-400 font-mono">{p.serialNumber}</p>
                                                                </div>
                                                                <div className="text-right flex-shrink-0">
                                                                    <p className="text-xs text-emerald-300">LKR {p.sellingPrice.toFixed(2)}</p>
                                                                    <p className={`text-[10px] ${p.quantity < p.lowStockThreshold ? "text-amber-400" : "text-slate-400"}`}>{p.quantity} in stock</p>
                                                                </div>
                                                            </div>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                            {invSearchOpen === i && invSearch.length > 1 && invSearchResults.length === 0 && (
                                                <div className="absolute z-10 top-7 left-0 right-0 bg-slate-800 border border-slate-600 rounded-xl shadow-xl px-3 py-2 text-xs text-slate-500">No parts found.</div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="flex items-center justify-between bg-blue-600/10 border border-blue-500/20 rounded-xl px-4 py-3">
                                <span className="text-sm font-semibold text-slate-300">Grand Total</span>
                                <span className="text-lg font-bold text-emerald-400">LKR {total(editItems).toFixed(2)}</span>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button onClick={() => { setEditQ(null); setInvSearchOpen(null); setInvSearch(""); setInvSearchResults([]); }} className="btn-secondary flex-1">Cancel</button>
                            <button onClick={finalize} disabled={finalizing || editItems.filter(i => i.description).length === 0} className="btn-success flex-1">
                                <CheckCircle className="w-4 h-4 inline mr-1.5" />
                                {finalizing ? "Finalizing…" : "Create Final Quotation & Download PDF"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {createQJob && (
                <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex justify-center items-start overflow-y-auto p-4 z-50 animate-fade-in custom-scrollbar">
                    <div className="bg-slate-800 border border-slate-700 w-full max-w-4xl rounded-2xl p-6 shadow-2xl my-8 relative">
                        <button onClick={() => { setCreateQJob(null); setInvSearchOpen(null); setInvSearch(""); setInvSearchResults([]); }} className="absolute bg-slate-800/80 p-2 rounded-full border border-slate-600 top-4 right-4 text-slate-400 hover:text-white">
                            <X className="w-5 h-5" />
                        </button>
                        <h2 className="text-xl font-bold mb-6 text-emerald-400">Generate Quotation</h2>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                            <div className="space-y-4">
                                <div><p className="text-xs text-slate-500 mb-1">Vehicle Details</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        <input value={qForm.vehicleNumber} onChange={e => setQForm({ ...qForm, vehicleNumber: e.target.value })} placeholder="Vehicle No. (e.g. CAA-1234)" className="input-field text-sm font-bold uppercase" />
                                        <input value={qForm.ownerName} onChange={e => setQForm({ ...qForm, ownerName: e.target.value })} placeholder="Owner Name" className="input-field text-sm" />
                                        <input value={qForm.telephone} onChange={e => setQForm({ ...qForm, telephone: e.target.value })} placeholder="Telephone" className="input-field text-sm" />
                                        <input value={qForm.vehicleType} onChange={e => setQForm({ ...qForm, vehicleType: e.target.value })} placeholder="Vehicle Type" className="input-field text-sm" />
                                        <input value={qForm.color} onChange={e => setQForm({ ...qForm, color: e.target.value })} placeholder="Color" className="input-field text-sm" />
                                        <input value={qForm.insuranceCompany} onChange={e => setQForm({ ...qForm, insuranceCompany: e.target.value })} placeholder="Insurance Company" className="input-field text-sm" />
                                        <input value={qForm.address} onChange={e => setQForm({ ...qForm, address: e.target.value })} placeholder="Address" className="col-span-2 input-field text-sm" />
                                    </div>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500 mb-1">Job Details & Notes</p>
                                    <textarea value={qForm.jobDetails} onChange={e => setQForm({ ...qForm, jobDetails: e.target.value })} className="input-field text-sm w-full h-24 custom-scrollbar" placeholder="Details..." />
                                </div>
                            </div>

                            <div>
                                <h4 className="text-sm font-semibold mb-3">Pricing Items</h4>
                                <button onClick={() => setQItems([...qItems, { description: "", partReplaced: "", price: 0, laborCost: 0, quantity: 1 }])} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mb-2"><Plus className="w-3 h-3" />Add Item</button>
                                <div className="space-y-3 mb-3">
                                    <div className="grid grid-cols-12 gap-2 text-xs text-slate-500 px-1">
                                        <span className="col-span-4">Desc</span><span className="col-span-2">Part</span><span className="col-span-1">Qty</span><span className="col-span-2">Part(Rs)</span><span className="col-span-2">Labor(Rs)</span>
                                    </div>
                                    {qItems.map((item, i) => (
                                        <div key={i} className="space-y-1">
                                            <div className="grid grid-cols-12 gap-2">
                                                <input value={item.description} onChange={e => { const n = [...qItems]; n[i].description = e.target.value; setQItems(n); }} placeholder="Job" className="input-field text-xs col-span-4" />
                                                <input value={item.partReplaced || ""} onChange={e => { const n = [...qItems]; n[i].partReplaced = e.target.value; setQItems(n); }} placeholder="Part" className="input-field text-xs col-span-2" />
                                                <input type="number" min="1" value={item.quantity ?? 1} onChange={e => { const n = [...qItems]; n[i].quantity = +e.target.value; setQItems(n); }} className="input-field text-xs col-span-1" />
                                                <input type="number" value={item.price} onChange={e => { const n = [...qItems]; n[i].price = +e.target.value; setQItems(n); }} className="input-field text-xs col-span-2" />
                                                <input type="number" value={item.laborCost} onChange={e => { const n = [...qItems]; n[i].laborCost = +e.target.value; setQItems(n); }} className="input-field text-xs col-span-2" />
                                                <button onClick={() => setQItems(items => items.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-400 flex items-center justify-center col-span-1"><X className="w-3.5 h-3.5" /></button>
                                            </div>
                                            <div className="relative col-span-12 pl-1">
                                                {invSearchOpen === i ? (
                                                    <div className="flex gap-2 items-center">
                                                        <input autoFocus value={invSearch} onChange={e => handleInvSearchChange(e.target.value)} placeholder="Search inventory..." className="input-field text-[10px] flex-1 py-1" />
                                                        <button onClick={() => { setInvSearchOpen(null); setInvSearch(""); setInvSearchResults([]); }} className="text-xs text-slate-500 hover:text-red-400"><X className="w-3 h-3" /></button>
                                                    </div>
                                                ) : (
                                                    <button onClick={() => { setInvSearchOpen(i); setInvSearch(""); setInvSearchResults([]); }} className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1">
                                                        <Package className="w-3 h-3" />{item.sparePartId ? <span className="text-emerald-400">Inventory Assigned</span> : "Pick part from inventory"}<ChevronDown className="w-3 h-3" />
                                                    </button>
                                                )}
                                                {invSearchOpen === i && invSearchResults.length > 0 && (
                                                    <div className="absolute z-10 top-7 left-0 right-0 bg-slate-800 border border-slate-600 rounded shadow-xl overflow-hidden">
                                                        {invSearchResults.map(p => (
                                                            <button key={p.id} onClick={() => selectPartForCreateItem(i, p)} className="w-full text-left px-2 py-1.5 hover:bg-slate-700 text-[10px] border-b border-slate-700/50 flex justify-between">
                                                                <div><span className="text-white block">{p.name}</span><span className="text-slate-400 font-mono">{p.serialNumber}</span></div>
                                                                <div className="text-right flex-shrink-0"><span className="text-emerald-300 block">Rs {p.sellingPrice}</span><span className={p.quantity < p.lowStockThreshold ? "text-amber-400" : "text-slate-400"}>Qty: {p.quantity}</span></div>
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex items-center justify-between bg-blue-600/10 border border-blue-500/20 rounded px-4 py-3 mt-4">
                                    <span className="text-sm font-semibold text-slate-300">Grand Total</span>
                                    <span className="text-lg font-bold text-emerald-400">LKR {total(qItems).toFixed(2)}</span>
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-3">
                            <button onClick={() => { setCreateQJob(null); setInvSearchOpen(null); setInvSearch(""); setInvSearchResults([]); }} className="btn-secondary flex-1">Cancel</button>
                            <button onClick={submitQuotation} disabled={qLoading || qItems.filter(i => i.description).length === 0} className="btn-success flex-1">
                                <CheckCircle className="w-4 h-4 inline mr-1.5" />
                                {qLoading ? "Generating Quotation…" : "Generate Quotation"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── AI Vehicle History Modal ────────────────────────────────── */}
            {aiVehicleModal && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setAiVehicleModal(null)}>
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
                        {/* Modal header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
                            <div className="flex items-center gap-2">
                                <Car className="w-5 h-5 text-blue-400" />
                                <div>
                                    <h2 className="text-white font-semibold">{aiVehicleModal.vehicleNumber}</h2>
                                    <p className="text-slate-400 text-xs">{aiVehicleModal.data?.ownerName || "Service History"}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => handleAIPrintReport(aiVehicleModal.vehicleNumber, aiVehicleModal.data)}
                                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-purple-600/20 border border-purple-500/40 text-purple-300 hover:bg-purple-600/30 rounded-lg transition-colors"
                                >
                                    <Printer className="w-3.5 h-3.5" /> Print Report
                                </button>
                                <button onClick={() => setAiVehicleModal(null)} className="text-slate-500 hover:text-slate-300 transition-colors">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Vehicle info */}
                        <div className="px-5 py-3 bg-slate-800/50 border-b border-slate-700/60 grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                            {[
                                ["Type", aiVehicleModal.data?.vehicleType],
                                ["Colour", aiVehicleModal.data?.color],
                                ["Telephone", aiVehicleModal.data?.telephone],
                                ["Address", aiVehicleModal.data?.address],
                            ].map(([label, val]) => val ? (
                                <div key={label} className="flex gap-1">
                                    <span className="text-slate-500 min-w-[60px]">{label}:</span>
                                    <span className="text-slate-300">{val}</span>
                                </div>
                            ) : null)}
                        </div>

                        {/* Jobs timeline */}
                        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                            {(!aiVehicleModal.data?.jobs || aiVehicleModal.data.jobs.length === 0) ? (
                                <p className="text-slate-500 text-sm text-center py-8">No service records found.</p>
                            ) : (
                                aiVehicleModal.data.jobs.map((job: any, idx: number) => {
                                    const q = job.quotations?.[0];
                                    return (
                                        <div key={job.id} className="relative pl-6">
                                            {/* Timeline line */}
                                            {idx < aiVehicleModal.data.jobs.length - 1 && (
                                                <div className="absolute left-[7px] top-6 bottom-0 w-px bg-slate-700" />
                                            )}
                                            {/* Timeline dot */}
                                            <div className="absolute left-0 top-1.5 w-3.5 h-3.5 rounded-full border-2 border-blue-500 bg-slate-900" />

                                            <div className="bg-slate-800 border border-slate-700/60 rounded-xl p-3">
                                                <div className="flex items-start justify-between gap-2 mb-1.5">
                                                    <div>
                                                        <span className="text-xs font-semibold text-white">
                                                            {JOB_TYPE_LABELS[job.jobType as keyof typeof JOB_TYPE_LABELS] || job.jobType}
                                                        </span>
                                                        <span className="text-[10px] text-slate-500 ml-2">#{job.jobNumber}</span>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-[10px] text-slate-400">{formatDate(job.createdAt)}</p>
                                                        {q?.totalAmount && (
                                                            <p className="text-xs font-semibold text-emerald-400">LKR {q.totalAmount.toLocaleString()}</p>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap gap-2 text-[10px]">
                                                    <span className="text-slate-400">Tech: <span className="text-slate-300">{job.employee?.name || "—"}</span></span>
                                                    <span className={`px-1.5 py-0.5 rounded font-medium ${
                                                        job.status === "COMPLETED" ? "bg-emerald-500/15 text-emerald-400" :
                                                        job.status === "FINALIZED" ? "bg-blue-500/15 text-blue-400" :
                                                        "bg-slate-700 text-slate-400"
                                                    }`}>{job.status}</span>
                                                </div>
                                                {job.notes && <p className="text-[10px] text-slate-500 mt-1 italic">"{job.notes}"</p>}
                                                {q?.items?.length > 0 && (
                                                    <div className="mt-2 space-y-0.5">
                                                        {q.items.slice(0, 3).map((item: any, i: number) => (
                                                            <p key={i} className="text-[10px] text-slate-500">
                                                                • {item.description}{item.partReplaced ? ` (${item.partReplaced})` : ""}
                                                            </p>
                                                        ))}
                                                        {q.items.length > 3 && (
                                                            <p className="text-[10px] text-slate-600">+{q.items.length - 3} more items</p>
                                                        )}
                                                    </div>
                                                )}
                                                {job.images?.length > 0 && (
                                                    <div className="flex gap-1.5 mt-2 overflow-x-auto">
                                                        {job.images.slice(0, 5).map((img: any) => (
                                                            <img
                                                                key={img.id}
                                                                src={`http://localhost:5001${img.url}`}
                                                                alt={img.phase}
                                                                className="w-12 h-12 object-cover rounded-lg border border-slate-600 flex-shrink-0"
                                                            />
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── AI Voice Assistant ─────────────────────────────────────── */}
            <AIAssistant
                context={editQ ? { vehicleNumber: editQ.vehicleNumber } : {}}
                onVehicleHistory={handleAIVehicleHistory}
                onPrintReport={handleAIPrintReport}
            />
        </DashboardLayout>
    );
}
