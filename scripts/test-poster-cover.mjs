import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCoverSwapQueue } from '../source/panel/wall/posterCover.ts';

test('cover swaps run at most two decodes and drain in order', () => {
  const queue = createCoverSwapQueue();
  const started = [];
  const done = [];
  const cancelled = [];
  for (let index = 0; index < 4; index++) {
    queue.enqueue(finish => {
      started.push(index);
      done[index] = finish;
      return () => { cancelled.push(index); };
    });
  }
  assert.deepEqual(started, [0, 1]);
  done[0]();
  assert.deepEqual(started, [0, 1, 2]);
  done[1]();
  assert.deepEqual(started, [0, 1, 2, 3]);
  queue.dispose();
  assert.deepEqual(cancelled, [2, 3]);
});

test('cover swaps pause pending work and cancellation removes a waiting job', () => {
  const queue = createCoverSwapQueue();
  const started = [];
  queue.setPaused(true);
  queue.enqueue(() => { started.push('keep'); return () => {}; });
  const cancel = queue.enqueue(() => { started.push('drop'); return () => {}; });
  cancel();
  assert.deepEqual(started, []);
  queue.setPaused(false);
  assert.deepEqual(started, ['keep']);
  queue.dispose();
});
