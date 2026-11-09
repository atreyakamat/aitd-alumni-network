import { EventEmitter } from 'events';
import { writeChunks } from '../../utils/streamResponse';

/** A response double: write() reports back-pressure for the first `blockAfter` chunks until 'drain' is emitted. */
class FakeResponse extends EventEmitter {
  chunks: string[] = [];
  ended = false;
  destroyed = false;
  writableEnded = false;
  constructor(private readonly blockEvery = 0) {
    super();
  }
  write(chunk: string) {
    this.chunks.push(chunk);
    return !(this.blockEvery && this.chunks.length % this.blockEvery === 0);
  }
  end() {
    this.ended = true;
    this.writableEnded = true;
  }
}

async function* make(...parts: string[]) {
  for (const part of parts) yield part;
}

describe('writeChunks', () => {
  it('writes every chunk in order and ends the response', async () => {
    const res = new FakeResponse();
    await writeChunks(res as any, make('a', 'b', 'c'));
    expect(res.chunks).toEqual(['a', 'b', 'c']);
    expect(res.ended).toBe(true);
  });

  it('ends an empty stream', async () => {
    const res = new FakeResponse();
    await writeChunks(res as any, make());
    expect(res.chunks).toEqual([]);
    expect(res.ended).toBe(true);
  });

  it('waits for drain when the socket buffer is full, instead of reading ahead', async () => {
    const res = new FakeResponse(1);
    let produced = 0;
    async function* counted() {
      for (const part of ['a', 'b', 'c']) {
        produced++;
        yield part;
      }
    }
    const done = writeChunks(res as any, counted());
    await new Promise((resolve) => setImmediate(resolve));
    expect(res.chunks).toEqual(['a']);
    expect(produced).toBe(1);
    res.emit('drain');
    await new Promise((resolve) => setImmediate(resolve));
    expect(res.chunks).toEqual(['a', 'b']);
    res.emit('drain');
    await new Promise((resolve) => setImmediate(resolve));
    res.emit('drain');
    await done;
    expect(res.chunks).toEqual(['a', 'b', 'c']);
    expect(res.ended).toBe(true);
  });

  it('stops reading when the client goes away while waiting for drain', async () => {
    const res = new FakeResponse(1);
    let finalised = false;
    async function* source() {
      try {
        yield 'a';
        yield 'b';
      } finally {
        finalised = true;
      }
    }
    const done = writeChunks(res as any, source());
    await new Promise((resolve) => setImmediate(resolve));
    res.destroyed = true;
    res.emit('close');
    await done;
    expect(res.chunks).toEqual(['a']);
    expect(finalised).toBe(true);
    expect(res.ended).toBe(false);
  });

  it('stops before writing when the client already went away', async () => {
    const res = new FakeResponse();
    res.destroyed = true;
    let finalised = false;
    async function* source() {
      try {
        yield 'a';
      } finally {
        finalised = true;
      }
    }
    await writeChunks(res as any, source());
    expect(res.chunks).toEqual([]);
    expect(finalised).toBe(true);
  });

  it('propagates a failure of the source so the caller can abort the response', async () => {
    const res = new FakeResponse();
    async function* broken() {
      yield 'a';
      throw new Error('db down');
    }
    await expect(writeChunks(res as any, broken())).rejects.toThrow('db down');
    expect(res.chunks).toEqual(['a']);
    expect(res.ended).toBe(false);
  });
});
