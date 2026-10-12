/**
 * Marker for accounts provisioned by a trusted OAuth provider. Password-based
 * sign-in always compares against a dummy bcrypt hash and rejects this value.
 */
export const OAUTH_ONLY_PASSWORD_HASH = "!oauth-only!";
