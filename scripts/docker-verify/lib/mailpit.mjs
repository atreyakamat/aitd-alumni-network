// Client for Mailpit, the mail catcher the test stack sends all its e-mail to (docker-compose.test.yml).
// API used: GET /api/v1/messages, GET /api/v1/message/{id}, DELETE /api/v1/messages.
import { createClient, until } from './http.mjs';

/** The verification token in the link of the "Verify your account" e-mail (`<frontend>/verify-email?token=...`). */
export const extractVerificationToken = (message) => {
  const text = `${message?.Text ?? ''}\n${message?.HTML ?? ''}`;
  const found = /verify-email\?token=([A-Za-z0-9._~%+-]+)/.exec(text);
  if (!found) return null;
  try {
    return decodeURIComponent(found[1]);
  } catch {
    return found[1];
  }
};

const addressesOf = (message) => (message?.To ?? []).map((to) => String(to.Address ?? '').toLowerCase());

export const createMailpit = (base, { http = createClient(base) } = {}) => {
  const list = async () => {
    const response = await http.get('/api/v1/messages?limit=500');
    if (response.status !== 200) throw new Error(`Mailpit answered ${response.status} ${response.error ?? ''}`.trim());
    return response.json?.messages ?? [];
  };
  return {
    base: http.base,
    list,
    ready: async () => (await http.get('/api/v1/messages?limit=1')).status === 200,
    clear: async () => (await http.delete('/api/v1/messages')).status === 200,
    full: async (id) => (await http.get(`/api/v1/message/${encodeURIComponent(id)}`)).json,
    /**
     * Waits for a message to `to` whose subject contains `subject`. Resolves { ok, message, waitedMs }; `message` is the full
     * message (Text and HTML included) when found.
     */
    waitFor: async ({ to, subject, timeoutMs = 60_000, intervalMs = 1_000 }) => {
      const wanted = String(to).toLowerCase();
      const outcome = await until(
        async () => (await list()).find((m) => addressesOf(m).includes(wanted) && String(m.Subject ?? '').includes(subject)),
        { timeoutMs, intervalMs }
      );
      if (!outcome.ok) return { ok: false, message: null, waitedMs: outcome.waitedMs };
      const full = (await http.get(`/api/v1/message/${encodeURIComponent(outcome.value.ID)}`)).json;
      return { ok: true, message: full, waitedMs: outcome.waitedMs };
    },
    /** Every subject sent to an address, for the evidence file. */
    subjectsTo: async (to) => (await list()).filter((m) => addressesOf(m).includes(String(to).toLowerCase())).map((m) => m.Subject),
  };
};
