/**
 * AIAssistant.tsx — Voice-Activated AI Assistant (Manager only)
 *
 * A floating chat-style panel that lets the manager query the workshop system
 * using natural language or voice input:
 *
 *  - Press the microphone button → MediaRecorder captures audio.
 *  - Stop → audio blob is posted to POST /api/voice/query.
 *  - The backend pipeline: Groq Whisper transcribes audio → LLaMA-3 classifies the
 *    intent (e.g. "get_vehicle_history", "get_inventory_status") → the matched handler
 *    fetches live data from the database and returns a structured response.
 *  - The response is displayed as a message card with intent-specific UI
 *    (vehicle history table, inventory list, financial summary, etc.).
 *
 * Text input is also supported for typed queries.
 * The panel is collapsible; on mobile it renders as a bottom sheet.
 */
"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, MicOff, X, Loader2, Volume2, Bot, ChevronDown, Printer, Car, Package, TrendingUp, Users } from "lucide-react";
import { voiceAPI } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueryResponse {
    transcript: string;
    response: string;
    intent: string;
    params: Record<string, string | null>;
    data: unknown;
}

interface Message {
    id: string;
    role: "user" | "assistant";
    text: string;
    intent?: string;
    data?: unknown;
    params?: Record<string, string | null>;
    timestamp: Date;
}

interface AIAssistantProps {
    /** Current page context the AI can reference (e.g. active vehicleNumber) */
    context?: Record<string, string>;
    /** Called when the AI returns vehicle history data so the parent can show it */
    onVehicleHistory?: (vehicleNumber: string, data: unknown) => void;
    /** Called when the AI wants to trigger a print/PDF for a vehicle */
    onPrintReport?: (vehicleNumber: string, data: unknown) => void;
}

// ─── TTS helper ───────────────────────────────────────────────────────────────

function speak(text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 1.05;
    utt.pitch = 1;
    // Prefer a British or US English female voice if available
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(
        (v) =>
            v.lang.startsWith("en") &&
            (v.name.toLowerCase().includes("female") ||
                v.name.toLowerCase().includes("samantha") ||
                v.name.toLowerCase().includes("karen") ||
                v.name.toLowerCase().includes("victoria"))
    );
    if (preferred) utt.voice = preferred;
    window.speechSynthesis.speak(utt);
}

// ─── Intent icon ─────────────────────────────────────────────────────────────

function IntentBadge({ intent }: { intent: string }) {
    const map: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
        vehicle_history: { icon: <Car className="w-3 h-3" />, label: "Vehicle History", color: "text-blue-400 bg-blue-400/10 border-blue-400/30" },
        print_report: { icon: <Printer className="w-3 h-3" />, label: "Print Report", color: "text-purple-400 bg-purple-400/10 border-purple-400/30" },
        inventory_query: { icon: <Package className="w-3 h-3" />, label: "Inventory", color: "text-amber-400 bg-amber-400/10 border-amber-400/30" },
        financial_query: { icon: <TrendingUp className="w-3 h-3" />, label: "Financials", color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30" },
        employee_status: { icon: <Users className="w-3 h-3" />, label: "Staff", color: "text-cyan-400 bg-cyan-400/10 border-cyan-400/30" },
    };
    const entry = map[intent];
    if (!entry) return null;
    return (
        <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${entry.color}`}>
            {entry.icon}{entry.label}
        </span>
    );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AIAssistant({ context = {}, onVehicleHistory, onPrintReport }: AIAssistantProps) {
    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [recording, setRecording] = useState(false);
    const [loading, setLoading] = useState(false);
    const [textInput, setTextInput] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [speaking, setSpeaking] = useState(false);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);
    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const textInputRef = useRef<HTMLInputElement | null>(null);

    // Auto-scroll to latest message
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Focus text input when panel opens
    useEffect(() => {
        if (open) setTimeout(() => textInputRef.current?.focus(), 150);
    }, [open]);

    // Cancel TTS on unmount
    useEffect(() => () => { window.speechSynthesis?.cancel(); }, []);

    const addMessage = useCallback((msg: Omit<Message, "id" | "timestamp">) => {
        setMessages((prev) => [
            ...prev,
            { ...msg, id: `${Date.now()}-${Math.random()}`, timestamp: new Date() },
        ]);
    }, []);

    // ── Handle AI response ────────────────────────────────────────────────────
    const handleResponse = useCallback(
        (result: QueryResponse) => {
            addMessage({
                role: "assistant",
                text: result.response,
                intent: result.intent,
                data: result.data,
                params: result.params,
            });

            // TTS
            setSpeaking(true);
            const utt = new SpeechSynthesisUtterance(result.response);
            utt.rate = 1.05;
            utt.onend = () => setSpeaking(false);
            utt.onerror = () => setSpeaking(false);
            const voices = window.speechSynthesis?.getVoices() ?? [];
            const preferred = voices.find(
                (v) =>
                    v.lang.startsWith("en") &&
                    (v.name.toLowerCase().includes("female") ||
                        v.name.toLowerCase().includes("samantha") ||
                        v.name.toLowerCase().includes("karen"))
            );
            if (preferred) utt.voice = preferred;
            window.speechSynthesis?.cancel();
            window.speechSynthesis?.speak(utt);

            // Trigger parent actions
            const vn = result.params?.vehicleNumber;
            if (result.intent === "vehicle_history" && vn && result.data) {
                onVehicleHistory?.(vn, result.data);
            }
            if (result.intent === "print_report" && vn && result.data) {
                onPrintReport?.(vn, result.data);
            }
        },
        [addMessage, onVehicleHistory, onPrintReport]
    );

    // ── Send text query ───────────────────────────────────────────────────────
    const sendText = useCallback(
        async (text: string) => {
            const trimmed = text.trim();
            if (!trimmed || loading) return;
            setError(null);
            setTextInput("");
            addMessage({ role: "user", text: trimmed });
            setLoading(true);
            try {
                const fd = new FormData();
                fd.append("text", trimmed);
                if (Object.keys(context).length) fd.append("context", JSON.stringify(context));
                const res = await voiceAPI.query(fd);
                handleResponse(res.data as QueryResponse);
            } catch (e: unknown) {
                const data = (e as { response?: { data?: { error?: string; details?: string } } })?.response?.data;
                const msg = data?.details ? `${data.error}: ${data.details}` : data?.error ?? "Request failed.";
                setError(msg);
            } finally {
                setLoading(false);
            }
        },
        [loading, context, addMessage, handleResponse]
    );

    // ── Start recording ───────────────────────────────────────────────────────
    const startRecording = useCallback(async () => {
        if (recording || loading) return;
        setError(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            audioChunksRef.current = [];

            const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
                ? "audio/webm;codecs=opus"
                : MediaRecorder.isTypeSupported("audio/webm")
                ? "audio/webm"
                : "audio/ogg";

            const recorder = new MediaRecorder(stream, { mimeType });
            mediaRecorderRef.current = recorder;

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunksRef.current.push(e.data);
            };

            recorder.onstop = async () => {
                stream.getTracks().forEach((t) => t.stop());
                streamRef.current = null;
                const blob = new Blob(audioChunksRef.current, { type: mimeType });
                if (blob.size < 1000) { setError("Recording too short — try again."); return; }
                setLoading(true);
                try {
                    const fd = new FormData();
                    fd.append("audio", blob, `voice.${mimeType.includes("ogg") ? "ogg" : "webm"}`);
                    if (Object.keys(context).length) fd.append("context", JSON.stringify(context));
                    const res = await voiceAPI.query(fd);
                    const result = res.data as QueryResponse;
                    addMessage({ role: "user", text: `🎤 "${result.transcript}"` });
                    handleResponse(result);
                } catch (e: unknown) {
                    const data = (e as { response?: { data?: { error?: string; details?: string } } })?.response?.data;
                    const msg = data?.details ? `${data.error}: ${data.details}` : data?.error ?? "Voice query failed.";
                    setError(msg);
                } finally {
                    setLoading(false);
                }
            };

            recorder.start();
            setRecording(true);
        } catch {
            setError("Microphone access denied.");
        }
    }, [recording, loading, context, addMessage, handleResponse]);

    // ── Stop recording ────────────────────────────────────────────────────────
    const stopRecording = useCallback(() => {
        if (!recording || !mediaRecorderRef.current) return;
        mediaRecorderRef.current.stop();
        setRecording(false);
    }, [recording]);

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <>
            {/* ── Floating trigger button ─────────────────────────────────── */}
            <button
                onClick={() => setOpen((o) => !o)}
                className={`fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 ${
                    open
                        ? "bg-slate-700 border border-slate-500 text-slate-300 hover:bg-slate-600"
                        : "bg-gradient-to-br from-blue-500 to-indigo-600 text-white hover:from-blue-400 hover:to-indigo-500 hover:scale-105"
                }`}
                title={open ? "Close assistant" : "Open AI Assistant"}
            >
                {open ? <ChevronDown className="w-6 h-6" /> : <Bot className="w-6 h-6" />}
                {/* Pulse ring when not open */}
                {!open && (
                    <span className="absolute inset-0 rounded-full border-2 border-blue-400 animate-ping opacity-30 pointer-events-none" />
                )}
            </button>

            {/* ── Chat panel ──────────────────────────────────────────────── */}
            {open && (
                <div className="fixed bottom-24 right-6 z-50 w-[360px] max-h-[600px] flex flex-col rounded-2xl border border-slate-600/60 bg-slate-900/95 backdrop-blur-md shadow-2xl overflow-hidden">

                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-600/20 to-indigo-600/20 border-b border-slate-700/60">
                        <div className="flex items-center gap-2">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center ${speaking ? "bg-blue-500 animate-pulse" : "bg-blue-600"}`}>
                                <Bot className="w-4 h-4 text-white" />
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-white leading-none">TrackNFix AI</p>
                                <p className="text-[10px] text-slate-400">
                                    {speaking ? "Speaking…" : recording ? "Listening…" : loading ? "Processing…" : "Ready"}
                                </p>
                            </div>
                        </div>
                        <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-300 transition-colors">
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0 scrollbar-thin">
                        {messages.length === 0 && (
                            <div className="text-center py-8 space-y-2">
                                <Bot className="w-10 h-10 text-slate-600 mx-auto" />
                                <p className="text-slate-500 text-sm font-medium">How can I help?</p>
                                <div className="text-xs text-slate-600 space-y-1 mt-3">
                                    <p>"Show history for WP-ABC-1234"</p>
                                    <p>"Is Nimal available today?"</p>
                                    <p>"What's our profit this month?"</p>
                                    <p>"Do we have enough oil filters?"</p>
                                </div>
                            </div>
                        )}

                        {messages.map((msg) => (
                            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                                <div
                                    className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                                        msg.role === "user"
                                            ? "bg-blue-600 text-white rounded-br-sm"
                                            : "bg-slate-800 border border-slate-700/50 text-slate-200 rounded-bl-sm"
                                    }`}
                                >
                                    {msg.role === "assistant" && msg.intent && msg.intent !== "general" && (
                                        <div className="mb-1.5">
                                            <IntentBadge intent={msg.intent} />
                                        </div>
                                    )}
                                    <p className="whitespace-pre-wrap">{msg.text}</p>

                                    {/* Quick-action buttons for actionable intents */}
                                    {msg.role === "assistant" && msg.intent === "vehicle_history" && !!msg.data && msg.params?.vehicleNumber && (
                                        <div className="mt-2 flex gap-1.5 flex-wrap">
                                            <button
                                                onClick={() => onVehicleHistory?.(msg.params!.vehicleNumber!, msg.data)}
                                                className="text-[10px] px-2 py-1 rounded bg-blue-500/20 border border-blue-500/40 text-blue-300 hover:bg-blue-500/30 transition-colors flex items-center gap-1"
                                            >
                                                <Car className="w-2.5 h-2.5" /> View Timeline
                                            </button>
                                            <button
                                                onClick={() => onPrintReport?.(msg.params!.vehicleNumber!, msg.data)}
                                                className="text-[10px] px-2 py-1 rounded bg-purple-500/20 border border-purple-500/40 text-purple-300 hover:bg-purple-500/30 transition-colors flex items-center gap-1"
                                            >
                                                <Printer className="w-2.5 h-2.5" /> Print Report
                                            </button>
                                        </div>
                                    )}

                                    {msg.role === "assistant" && msg.intent === "print_report" && !!msg.data && msg.params?.vehicleNumber && (
                                        <div className="mt-2">
                                            <button
                                                onClick={() => onPrintReport?.(msg.params!.vehicleNumber!, msg.data)}
                                                className="text-[10px] px-2 py-1 rounded bg-purple-500/20 border border-purple-500/40 text-purple-300 hover:bg-purple-500/30 transition-colors flex items-center gap-1"
                                            >
                                                <Printer className="w-2.5 h-2.5" /> Open Print Dialog
                                            </button>
                                        </div>
                                    )}

                                    <p className="text-[10px] mt-1 opacity-40 text-right">
                                        {msg.timestamp.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                                    </p>
                                </div>
                            </div>
                        ))}

                        {/* Loading bubble */}
                        {loading && (
                            <div className="flex justify-start">
                                <div className="bg-slate-800 border border-slate-700/50 rounded-2xl rounded-bl-sm px-3 py-2 flex items-center gap-2">
                                    <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                                    <span className="text-slate-400 text-xs">Processing…</span>
                                </div>
                            </div>
                        )}

                        {/* Error */}
                        {error && (
                            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-xs text-red-400">
                                {error}
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input area */}
                    <div className="px-3 pb-3 pt-2 border-t border-slate-700/60 space-y-2">
                        {/* Text input row */}
                        <form
                            onSubmit={(e) => { e.preventDefault(); sendText(textInput); }}
                            className="flex gap-2"
                        >
                            <input
                                ref={textInputRef}
                                type="text"
                                value={textInput}
                                onChange={(e) => setTextInput(e.target.value)}
                                disabled={loading || recording}
                                placeholder="Type a question…"
                                className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 disabled:opacity-50 transition-colors"
                            />
                            <button
                                type="submit"
                                disabled={!textInput.trim() || loading || recording}
                                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-white text-xs font-medium transition-colors"
                            >
                                Send
                            </button>
                        </form>

                        {/* Voice row */}
                        <div className="flex items-center justify-between">
                            <p className="text-[10px] text-slate-600">
                                {recording ? "Release to send" : "Hold to speak"}
                            </p>

                            <button
                                onMouseDown={startRecording}
                                onMouseUp={stopRecording}
                                onMouseLeave={recording ? stopRecording : undefined}
                                onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
                                onTouchEnd={stopRecording}
                                disabled={loading}
                                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 select-none ${
                                    recording
                                        ? "bg-red-500 text-white scale-105 shadow-lg shadow-red-500/30"
                                        : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                                } disabled:opacity-40 disabled:cursor-not-allowed`}
                            >
                                {recording ? (
                                    <>
                                        <MicOff className="w-3.5 h-3.5" />
                                        Recording…
                                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-400 animate-ping" />
                                    </>
                                ) : (
                                    <>
                                        <Mic className="w-3.5 h-3.5" />
                                        Voice
                                    </>
                                )}
                            </button>

                            {speaking && (
                                <button
                                    onClick={() => { window.speechSynthesis?.cancel(); setSpeaking(false); }}
                                    className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                                >
                                    <Volume2 className="w-3 h-3 animate-pulse" /> Stop
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
