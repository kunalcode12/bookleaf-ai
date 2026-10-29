export interface IdentitySession {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface VerifiedToken {
  userId: string;
  expiresAt: Date;
}

/**
 * Who issues and verifies logins. Production uses Supabase Auth (password hashing, refresh
 * rotation, brute-force protection are Supabase's job, not ours); local development and tests
 * use an embedded provider with the same contract.
 */
export interface IdentityProvider {
  readonly kind: 'supabase' | 'local';
  signIn(email: string, password: string): Promise<IdentitySession>;
  refresh(refreshToken: string): Promise<IdentitySession>;
  signOut(session: { accessToken?: string | null; refreshToken?: string | null }): Promise<void>;
  verify(accessToken: string): Promise<VerifiedToken>;
  /** Creates the login if missing (or resets its password) — used by the seed. */
  ensureUser(email: string, password: string): Promise<{ userId: string; created: boolean }>;
}
