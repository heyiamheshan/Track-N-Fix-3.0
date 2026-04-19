/**
 * voiceUtils.ts
 * Helpers for normalising Groq Whisper output before passing it
 * to the LLaMA intent classifier.
 */

// ── Vehicle-number normalisation ──────────────────────────────────────────────

/** Maps spoken number words to their digit equivalents. */
const NUMBER_WORDS: Record<string, string> = {
    zero: '0', one: '1', two: '2', three: '3', four: '4',
    five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};

/**
 * Converts a Whisper-transcribed vehicle number phrase into the canonical
 * Sri Lankan registration format, e.g. "WP-ABC-1234".
 *
 * Handles:
 *  - Province prefix words  ("wp" → "WP")
 *  - Single letter tokens   ("a", "b", "c")
 *  - Number words           ("one", "two" … "nine")
 *  - Already-digit tokens   ("1234")
 *
 * @example
 *   normalizeVehicleNumber("wp a b c one two three four")
 *   // → "WP-ABC-1234"
 */
export function normalizeVehicleNumber(whisperOutput: string): string {
    const tokens = whisperOutput.toLowerCase().trim().split(/\s+/);
    const parts: string[] = [];

    for (const token of tokens) {
        if (NUMBER_WORDS[token] !== undefined) {
            parts.push(NUMBER_WORDS[token]);
        } else if (/^[a-z]$/.test(token)) {
            parts.push(token.toUpperCase());
        } else if (/^\d+$/.test(token)) {
            // Already a digit string (e.g. "1234")
            for (const ch of token) parts.push(ch);
        } else if (/^[a-z]{2,}$/.test(token) && NUMBER_WORDS[token] === undefined) {
            // Multi-letter word that isn't a number word — treat as province or
            // letter cluster (e.g. "wp" → "WP").
            for (const ch of token) parts.push(ch.toUpperCase());
        }
    }

    // Expected layout: 2 province chars + 3 letter chars + 4 digit chars = 9 chars
    if (parts.length >= 9) {
        const province = parts.slice(0, 2).join('');
        const letters  = parts.slice(2, 5).join('');
        const numbers  = parts.slice(5, 9).join('');
        return `${province}-${letters}-${numbers}`;
    }

    return parts.join('');
}

// ── Intent normalisation ──────────────────────────────────────────────────────

/**
 * Maps granular LLaMA intents to the broader action categories used in the UI.
 *
 * Both "vehicle_history" and "print_report" resolve to the same retrieval
 * action so the frontend can treat them uniformly.
 */
export function normalizeIntent(intent: string): string {
    const INTENT_MAP: Record<string, string> = {
        vehicle_history: 'RETRIEVE_HISTORY',
        print_report:    'RETRIEVE_HISTORY',
        inventory_query: 'INVENTORY_QUERY',
        employee_status: 'EMPLOYEE_STATUS',
        financial_query: 'FINANCIAL_QUERY',
        general:         'GENERAL',
    };
    return INTENT_MAP[intent] ?? intent.toUpperCase();
}
