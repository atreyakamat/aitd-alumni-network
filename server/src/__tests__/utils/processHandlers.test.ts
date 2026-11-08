import { EventEmitter } from 'events';
import { registerProcessHandlers } from '../../utils/processHandlers';
import { log } from '../../utils/logger';

jest.mock('../../utils/logger', () => ({ log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const setup = () => {
  const proc = new EventEmitter();
  const shutdown = jest.fn().mockResolvedValue(undefined);
  registerProcessHandlers({ proc, shutdown });
  return { proc, shutdown };
};

beforeEach(() => jest.clearAllMocks());

describe('registerProcessHandlers', () => {
  it.each(['SIGTERM', 'SIGINT'])('%s starts a graceful shutdown (a normal exit)', (signal) => {
    const { proc, shutdown } = setup();
    proc.emit(signal);
    expect(shutdown).toHaveBeenCalledWith(signal);
  });

  it('an uncaught exception is logged with its stack and shuts the process down as a FAILURE, so it restarts clean', () => {
    const { proc, shutdown } = setup();
    const error = new Error('state is now unknown');
    proc.emit('uncaughtException', error);

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Uncaught exception'), { err: error });
    expect(shutdown).toHaveBeenCalledWith('uncaughtException', true);
  });

  it('an unhandled rejection is logged but does not take the server down', () => {
    const { proc, shutdown } = setup();
    proc.emit('unhandledRejection', new Error('a forgotten promise'));

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Unhandled promise rejection'), expect.objectContaining({ err: expect.any(Error) }));
    expect(shutdown).not.toHaveBeenCalled();
  });

  it('handles a rejection with a non-error reason', () => {
    const { proc } = setup();
    expect(() => proc.emit('unhandledRejection', 'just a string')).not.toThrow();
    expect(log.error).toHaveBeenCalled();
  });
});
