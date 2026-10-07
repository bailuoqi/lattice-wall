import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLibraryTrackLoader } from '../source/panel/host/libraryModel.ts';
import { createPageLoader } from '../source/panel/albums/albumModel.ts';

test('remote wall paging carries source and search through both host batches', async () => {
  const queries = [];
  const loader = createLibraryTrackLoader(async query => {
    queries.push(query);
    return { page: query.page, pageSize: 100, total: 400, hasMore: query.page < 4,
      items: Array.from({ length: 100 }, (_, i) => ({ id: `${query.page}-${i}` })) };
  });
  assert.equal((await loader.load(2, 'artist', 'remote')).items.length, 200);
  assert.deepEqual(queries, [3, 4].map(page => ({ page, pageSize: 100, search: 'artist', sourceProvider: 'remote' })));
});

for (const [name, create] of [
  ['tracks', read => createLibraryTrackLoader(read)],
  ['albums', read => createPageLoader(read, 60)],
]) {
  for (const fail of [false, true]) {
    test(`${name}: source switch discards late local ${fail ? 'failure' : 'result'}`, async () => {
      const calls = [];
      const loader = create(query => new Promise((resolve, reject) => calls.push({ query, resolve, reject })));
      const old = loader.load(1);
      const fresh = loader.load(1, '', 'remote');
      assert.equal(calls[0].query.sourceProvider, 'local');
      assert.equal(calls[1].query.sourceProvider, 'remote');
      const remote = { page: 1, pageSize: 60, total: 1, hasMore: false, items: [{ id: 'remote-song' }] };
      calls[1].resolve(remote);
      assert.equal((await fresh).items[0].id, 'remote-song');
      if (fail) calls[0].reject(new Error('late local error'));
      else calls[0].resolve({ ...remote, items: [{ id: 'local-song' }] });
      assert.equal(await old, null);
      const back = loader.load(1, '', 'local');
      assert.equal(calls[2].query.sourceProvider, 'local');
      calls[2].resolve({ ...remote, items: [] });
      assert.deepEqual((await back).items, []);
    });
  }
}
