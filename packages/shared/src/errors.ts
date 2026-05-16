export type ApiErrorCode =
  | "invalid_payload"
  | "invalid_auth"
  | "not_found"
  | "device_revoked"
  | "feature_not_enabled"
  | "expired_code"
  | "rate_limited";

export function apiError(
  code: ApiErrorCode,
  message: string,
  details?: unknown,
) {
  return { error: { code, message, details } };
}
