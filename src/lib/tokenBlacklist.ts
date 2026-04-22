// In-memory token blacklist for revoked tokens
// For production: use Redis with TTL matching token expiry
const blacklist = new Set<string>()

export function blacklistToken(token: string): void {
  blacklist.add(token)
  // Auto-cleanup after 25h (slightly longer than token expiry)
  setTimeout(() => blacklist.delete(token), 25 * 60 * 60 * 1000)
}

export function isBlacklisted(token: string): boolean {
  return blacklist.has(token)
}
