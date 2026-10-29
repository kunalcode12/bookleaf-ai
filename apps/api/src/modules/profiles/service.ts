import type { SessionUser, UserRole } from '@bookleaf/contracts';
import { type Database, SYSTEM_ACTOR, schema, withActor } from '@bookleaf/db';
import { asc, eq } from 'drizzle-orm';
import { LRUCache } from 'lru-cache';
import type { RequestActor } from '../../http/context';

export interface ProfileRecord {
  id: string;
  email: string;
  role: UserRole;
  displayName: string;
  title: string | null;
  author: { id: string; externalId: string; name: string; city: string | null; joinedDate: string } | null;
}

/**
 * Maps identity-provider users to BookLeaf profiles (role, linked author). Cached briefly: the
 * auth hook resolves the profile on every request, and roles change rarely.
 */
export class ProfileService {
  private readonly cache = new LRUCache<string, ProfileRecord>({ max: 5000, ttl: 30_000 });

  constructor(private readonly db: Database) {}

  async byUserId(userId: string): Promise<ProfileRecord | null> {
    const cached = this.cache.get(userId);
    if (cached) return cached;
    const [row] = await withActor(
      this.db,
      SYSTEM_ACTOR,
      (tx) =>
        tx
          .select({
            id: schema.profiles.id,
            email: schema.profiles.email,
            role: schema.profiles.role,
            displayName: schema.profiles.displayName,
            title: schema.profiles.title,
            authorId: schema.authors.id,
            authorExternalId: schema.authors.externalId,
            authorName: schema.authors.name,
            authorCity: schema.authors.city,
            authorJoined: schema.authors.joinedDate,
          })
          .from(schema.profiles)
          .leftJoin(schema.authors, eq(schema.authors.id, schema.profiles.authorId))
          .where(eq(schema.profiles.id, userId))
          .limit(1),
      { readOnly: true },
    );
    if (!row) return null;
    const profile: ProfileRecord = {
      id: row.id,
      email: row.email,
      role: row.role,
      displayName: row.displayName,
      title: row.title,
      author:
        row.authorId && row.authorExternalId && row.authorName && row.authorJoined
          ? {
              id: row.authorId,
              externalId: row.authorExternalId,
              name: row.authorName,
              city: row.authorCity,
              joinedDate: row.authorJoined,
            }
          : null,
    };
    this.cache.set(userId, profile);
    return profile;
  }

  invalidate(userId: string) {
    this.cache.delete(userId);
  }

  toActor(profile: ProfileRecord, userId: string): RequestActor {
    return {
      userId,
      profileId: profile.id,
      role: profile.role,
      authorId: profile.author?.id ?? null,
      displayName: profile.displayName,
      title: profile.title,
      email: profile.email,
      db:
        profile.role === 'author' && profile.author
          ? { kind: 'author', profileId: profile.id, authorId: profile.author.id }
          : { kind: 'admin', profileId: profile.id },
    };
  }

  toSessionUser(profile: ProfileRecord): SessionUser {
    return {
      id: profile.id,
      email: profile.email,
      role: profile.role,
      displayName: profile.displayName,
      title: profile.title,
      author: profile.author,
    };
  }

  async touch(profileId: string): Promise<void> {
    await withActor(this.db, SYSTEM_ACTOR, (tx) =>
      tx.update(schema.profiles).set({ lastSeenAt: new Date() }).where(eq(schema.profiles.id, profileId)),
    );
  }

  async listAdmins(): Promise<Array<{ id: string; displayName: string; title: string | null }>> {
    return withActor(
      this.db,
      SYSTEM_ACTOR,
      (tx) =>
        tx
          .select({
            id: schema.profiles.id,
            displayName: schema.profiles.displayName,
            title: schema.profiles.title,
          })
          .from(schema.profiles)
          .where(eq(schema.profiles.role, 'admin'))
          .orderBy(asc(schema.profiles.displayName)),
      { readOnly: true },
    );
  }
}
