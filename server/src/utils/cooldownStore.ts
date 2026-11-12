/**
 * In-process cooldown reservations: "this key was used less than `windowMs` ago".
 *
 * Used by notification de-duplication to close the gap a database lookup leaves open: a burst of parallel requests, or a Kafka
 * consumer that has not stored the first notification yet, would all find "nothing earlier" and all send. The claim is made
 * synchronously (no await between the check and the write), so exactly one caller wins.
 *
 * Per process and in memory by design: it is a second layer in front of the database lookup, which is shared by every process and
 * survives restarts. The map is bounded so a long uptime cannot grow it without limit.
 */
const reserved = new Map<string, number>();
export const MAX_COOLDOWN_KEYS = 5000;

/** Claims `key` for `windowMs`. False when a claim made less than `windowMs` ago is still running. */
export const claimCooldown = (key: string, windowMs: number): boolean => {
  const now = Date.now();
  const until = reserved.get(key);
  if (until !== undefined && until > now) return false;
  if (reserved.size >= MAX_COOLDOWN_KEYS) {
    for (const [k, end] of reserved) if (end <= now) reserved.delete(k);
    if (reserved.size >= MAX_COOLDOWN_KEYS) reserved.clear();
  }
  reserved.set(key, now + windowMs);
  return true;
};

/** Gives a claim back (the thing it guarded was not done). */
export const releaseCooldown = (key: string): void => {
  reserved.delete(key);
};

/** Forgets every claim (tests, and nothing else). */
export const resetCooldowns = (): void => reserved.clear();
