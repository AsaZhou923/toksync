export type ApiErrorCode =
  | "invalid_payload"
  | "invalid_auth"
  | "privacy_violation"
  | "not_found"
  | "device_revoked"
  | "feature_not_enabled"
  | "not_configured"
  | "invalid_oauth_state"
  | "oauth_exchange_failed"
  | "oauth_profile_failed"
  | "unsupported_query"
  | "payload_too_large"
  | "expired_code"
  | "consumed_code"
  | "internal_error"
  | "rate_limited";

export function apiError(
  code: ApiErrorCode,
  message: string,
  details?: unknown,
) {
  return { error: { code, message, details } };
}
