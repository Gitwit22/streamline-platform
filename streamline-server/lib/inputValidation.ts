export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: "invalid_input"; details?: string };

export function asTrimmedString(
  input: unknown,
  opts: { required?: boolean; maxLen?: number } = {}
): ValidationResult<string | undefined> {
  const { required = false, maxLen } = opts;

  if (input === undefined || input === null) {
    if (required) {
      return { ok: false, error: "invalid_input", details: "missing string" };
    }
    return { ok: true, value: undefined };
  }

  if (typeof input !== "string") {
    return { ok: false, error: "invalid_input", details: "must be a string" };
  }

  const trimmed = input.trim();

  if (required && !trimmed) {
    return { ok: false, error: "invalid_input", details: "must not be empty" };
  }

  if (maxLen !== undefined && trimmed.length > maxLen) {
    return { ok: false, error: "invalid_input", details: `max length is ${maxLen}` };
  }

  return { ok: true, value: trimmed };
}

export function asOptionalBoolean(input: unknown): ValidationResult<boolean | undefined> {
  if (input === undefined || input === null) return { ok: true, value: undefined };
  if (typeof input !== "boolean") {
    return { ok: false, error: "invalid_input", details: "must be a boolean" };
  }
  return { ok: true, value: input };
}

export function asOptionalEnum<T extends readonly string[]>(
  input: unknown,
  allowed: T
): ValidationResult<T[number] | undefined> {
  if (input === undefined || input === null) return { ok: true, value: undefined };
  if (typeof input !== "string") {
    return { ok: false, error: "invalid_input", details: "must be a string" };
  }
  if (!(allowed as readonly string[]).includes(input)) {
    return {
      ok: false,
      error: "invalid_input",
      details: `must be one of: ${allowed.join(", ")}`,
    };
  }
  return { ok: true, value: input as T[number] };
}
