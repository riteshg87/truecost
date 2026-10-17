export type ContractErrorCode =
  | "invalid_shape"
  | "unknown_field"
  | "invalid_enum"
  | "invalid_number"
  | "invalid_id"
  | "invalid_timestamp"
  | "unsupported_schema"
  | "id_mismatch"
  | "duplicate_id"
  | "wrong_count"
  | "expired"
  | "account_mismatch"
  | "stale_epoch"
  | "tab_mismatch"
  | "claim_mismatch"
  | "invalid_state"
  | "lease_expired";

/** A stable, provider-independent failure that callers can classify safely. */
export class ContractValidationError extends Error {
  readonly code: ContractErrorCode;

  constructor(code: ContractErrorCode, message: string) {
    super(message);
    this.name = "ContractValidationError";
    this.code = code;
  }
}

export function contractFail(
  code: ContractErrorCode,
  message: string,
): never {
  throw new ContractValidationError(code, message);
}

export function recordOf(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    contractFail("invalid_shape", `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function exactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) {
      contractFail("unknown_field", `${label}.${key} is not supported`);
    }
  }
}

export function stringValue(
  value: unknown,
  label: string,
  maxLength: number,
  required = true,
): string {
  if (typeof value !== "string" || (required && value.length === 0)) {
    contractFail("invalid_shape", `${label} must be a string`);
  }
  if (value.length > maxLength) {
    contractFail("invalid_shape", `${label} is too long`);
  }
  return value;
}

export function finiteNumber(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    contractFail("invalid_number", `${label} must be finite and bounded`);
  }
  return value;
}

export function integerValue(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  const number = finiteNumber(value, label, min, max);
  if (!Number.isInteger(number)) {
    contractFail("invalid_number", `${label} must be an integer`);
  }
  return number;
}

export function canonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 32) {
    contractFail("invalid_timestamp", `${label} must be an ISO timestamp`);
  }
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString() !== value
  ) {
    contractFail("invalid_timestamp", `${label} must use canonical UTC ISO format`);
  }
  return value;
}

export function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}

export function randomUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
      .slice(6, 8)
      .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }
  contractFail("invalid_id", "Secure UUID generation is unavailable");
}

export function uuidValue(value: unknown, label: string): string {
  const uuid = stringValue(value, label, 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      uuid,
    )
  ) {
    contractFail("invalid_id", `${label} must be a UUID`);
  }
  return uuid;
}
