import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date) {
    return new Date(date).toLocaleDateString("en-GB", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
}

export const JOB_TYPE_LABELS: Record<string, string> = {
    SERVICE: "Monthly Service",
    REPAIR: "Repair",
    ACCIDENT_RECOVERY: "Accident Recovery",
};

export const JOB_STATUS_LABELS: Record<string, string> = {
    DRAFT: "Draft",
    SUBMITTED: "Submitted",
    REVIEWED: "Reviewed",
    QUOTED: "Quoted",
    FINALIZED: "Finalized",
};

export const QUOTATION_STATUS_LABELS: Record<string, string> = {
    DRAFT: "Draft",
    SENT_TO_MANAGER: "Sent to Manager",
    FINALIZED: "Finalized",
};
