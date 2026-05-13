import { MongoClient, type Db, type Collection } from 'mongodb';
import { config } from '../config.js';

interface EmbedUser {
  username: string;
  banned: boolean;
  premium: boolean;
  banReason?: string | null;
  bannedAt?: Date | null;
  bannedBy?: string | null;
  /** Source of the `premium` flag. 'subs' = synced from VSC subscription;
   *  'testing' = 1-time Pro trial; absent/other = manual upgrade. The
   *  premiumSubsSync worker only demotes rows whose source it owns. */
  premium_source?: 'subs' | 'testing' | null;
  /** ISO timestamp at which the current `premium=true` flag should be
   *  revoked. Set for one-time passes and the Pro trial. */
  premium_expires_at?: Date | null;
  /** Set the FIRST time the user starts the Pro trial. Never cleared,
   *  so we can refuse repeat trials for life. */
  testing_started?: Date | null;
}

let db: Db | null = null;
let collection: Collection<EmbedUser> | null = null;

// In-memory cache to avoid hitting MongoDB on every request
const cache = new Map<string, { user: EmbedUser | null; expires: number }>();
const CACHE_TTL = 60_000; // 1 minute

async function getCollection(): Promise<Collection<EmbedUser> | null> {
  if (collection) return collection;
  if (!config.MONGODB_URI) return null;

  try {
    const client = new MongoClient(config.MONGODB_URI);
    await client.connect();
    db = client.db();
    collection = db.collection<EmbedUser>('embed-users');
    console.log('[Users] Connected to MongoDB');
    return collection;
  } catch (err) {
    console.error('[Users] Failed to connect to MongoDB:', err);
    return null;
  }
}

async function getUser(username: string): Promise<EmbedUser | null> {
  // Check cache
  const cached = cache.get(username);
  if (cached && cached.expires > Date.now()) {
    return cached.user;
  }

  const col = await getCollection();
  if (!col) return null;

  try {
    const user = await col.findOne({ username });
    cache.set(username, { user, expires: Date.now() + CACHE_TTL });
    return user;
  } catch (err) {
    // Connection dropped — reset so getCollection() reconnects next time
    console.error('[Users] Query failed, resetting connection:', err);
    collection = null;
    db = null;
    return null;
  }
}

export async function isUserBanned(username: string): Promise<boolean> {
  const user = await getUser(username);
  return user?.banned === true;
}

export async function isUserPremium(username: string): Promise<boolean> {
  const user = await getUser(username);
  return user?.premium === true;
}

export async function getUserStatus(username: string): Promise<{ banned: boolean; premium: boolean }> {
  const user = await getUser(username);
  return {
    banned: user?.banned === true,
    premium: user?.premium === true,
  };
}

export type StartProTrialResult =
  | { ok: true; expiresAt: Date }
  | { ok: false; reason: 'already_used' | 'banned' | 'mongo_unavailable' };

/**
 * One-time Pro trial: flip `premium=true` with source='testing' and a
 * fixed expiry. Refuses if the user already used their trial (via the
 * sticky `testing_started` field) or is banned. The premiumSubsSync
 * worker on the checker side respects `premium_source='testing'` until
 * `premium_expires_at` passes, then demotes — `testing_started` stays
 * so the trial can't be claimed twice in a lifetime.
 */
export async function startProTrial(
  username: string,
  durationHours: number,
): Promise<StartProTrialResult> {
  const col = await getCollection();
  if (!col) return { ok: false, reason: 'mongo_unavailable' };

  const existing = await col.findOne({ username });
  if (existing?.banned === true) return { ok: false, reason: 'banned' };
  if (existing?.testing_started) return { ok: false, reason: 'already_used' };

  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

  try {
    await col.updateOne(
      { username },
      {
        $set: {
          premium: true,
          premium_source: 'testing',
          premium_synced_at: now,
          premium_expires_at: expiresAt,
          testing_started: now,
        },
        $setOnInsert: { username, banned: false },
      },
      { upsert: true },
    );
  } catch (err) {
    console.error('[Users] startProTrial failed:', err);
    return { ok: false, reason: 'mongo_unavailable' };
  }

  // Bust the cached row so the next isUserPremium / getUserStatus call
  // reflects the new flag immediately (otherwise the 60s TTL would have
  // a fresh trial appear "non-premium" for up to a minute).
  cache.delete(username);
  return { ok: true, expiresAt };
}
