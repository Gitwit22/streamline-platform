/**
 * Email address validation and normalisation helpers.
 */
/**
 * Returns true when the value looks like a valid email address.
 *
 * Uses a structural check rather than a complex regex to avoid ReDoS
 * vulnerabilities while still catching obviously invalid inputs.
 */
export declare function isValidEmail(email: unknown): email is string;
/**
 * Normalises an email for storage and comparison.
 * Trims whitespace and lowercases the entire address.
 */
export declare function normalizeEmail(email: string): string;
