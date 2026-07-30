import { getLogger, getRecentErrors } from '../../src/shared/logger/index';

describe('logger — recent errors ring buffer', () => {
  it('captures .error() calls with a string message', () => {
    getLogger().error('something broke');

    const [latest] = getRecentErrors();
    expect(latest?.message).toBe('something broke');
    expect(typeof latest?.time).toBe('number');
  });

  it('captures .error() calls with a mergingObject + msg pair, preferring the msg', () => {
    getLogger().error({ err: new Error('inner') }, 'YooKassa webhook failed');

    const [latest] = getRecentErrors();
    expect(latest?.message).toBe('YooKassa webhook failed');
  });

  it('does not capture .warn()/.info() calls', () => {
    const before = getRecentErrors().length;
    getLogger().warn('just a warning');
    getLogger().info('just info');

    expect(getRecentErrors().length).toBe(before);
  });

  it('returns newest first', () => {
    getLogger().error('first');
    getLogger().error('second');

    const [newest, secondNewest] = getRecentErrors();
    expect(newest?.message).toBe('second');
    expect(secondNewest?.message).toBe('first');
  });

  it('caps the buffer at 50 entries', () => {
    for (let i = 0; i < 60; i++) {
      getLogger().error(`error-${i}`);
    }

    const errors = getRecentErrors();
    expect(errors.length).toBeLessThanOrEqual(50);
    expect(errors[0]?.message).toBe('error-59');
  });
});
