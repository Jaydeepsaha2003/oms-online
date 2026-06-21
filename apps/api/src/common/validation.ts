/** Shared format validators so the DTO (form) and the import path agree. */

/** Digits with optional +, spaces, hyphens, parentheses; ~7–19 digits total. */
export const MOBILE_REGEX = /^\+?[0-9][0-9\s\-()]{6,18}$/;

/** Pragmatic email shape: something@something.something with no spaces. */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isValidMobile = (v: string): boolean => MOBILE_REGEX.test(v.trim());
export const isValidEmail = (v: string): boolean => EMAIL_REGEX.test(v.trim());
