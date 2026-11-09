import type { Writable } from 'stream';

/** Resolves true when the socket buffer has room again, false when the client went away first. */
const waitForDrain = (res: Writable): Promise<boolean> =>
  new Promise((resolve) => {
    const done = (ok: boolean) => {
      res.off('drain', onDrain);
      res.off('close', onClose);
      resolve(ok);
    };
    const onDrain = () => done(true);
    const onClose = () => done(false);
    res.once('drain', onDrain);
    res.once('close', onClose);
  });

/**
 * Writes an async sequence of text chunks to an HTTP response and ends it.
 *
 * - Back-pressure: when the socket buffer is full the source is not read again until it drains, so a slow client
 *   never makes the server buffer the whole export.
 * - A client that disconnects stops the source (its `finally` blocks run) and nothing more is written.
 * - A failure of the source is thrown to the caller, which decides how to abort a response that has begun.
 */
export const writeChunks = async (res: Writable, chunks: AsyncIterable<string>): Promise<void> => {
  for await (const chunk of chunks) {
    if (res.destroyed || res.writableEnded) return;
    if (!res.write(chunk) && !(await waitForDrain(res))) return;
  }
  if (!res.destroyed && !res.writableEnded) res.end();
};
