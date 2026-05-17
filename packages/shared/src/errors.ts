export type ApiErrorCode =
  | "invalid_payload"
  | "invalid_auth"
  | "privacy_violation"
  | "not_found"
  | "device_revoked"
  | "feature_not_enabled"
  | "expired_code"
  | "consumed_code"
  | "rate_limited";

export function apiError(
  code: ApiErrorCode,
  message: string,
  details?: unknown,
) {
  return { error: { code, message, details } };
}
