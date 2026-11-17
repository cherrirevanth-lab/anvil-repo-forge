// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  compareManifests,
  createManifest,
  exportBundle,
  importBundle,
  verifyManifest,
  walkTree,
} from '../src/index.mjs';

async function fixture(name, files) {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-${name}-`));
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return dir;
}

const sample = {
  'README.md': '# sample\n',
  'src/index.mjs': 'export const x = 1;\n',
  'src/util/strings.mjs': 'export const up = (s) => s.toUpperCase();\n',
};

test('walkTree returns sorted posix paths and skips excluded directories', async () => {
  const dir = await fixture('walk', { ...sample, 'node_modules/x/index.js': 'nope', '.git/config': 'nope' });
  const paths = await walkTree(dir);
  assert.deepEqual(paths, ['README.md', 'src/index.mjs', 'src/util/strings.mjs']);
  await rm(dir, { recursive: true, force: true });
});

test('manifest records bytes and hash for every file', async () => {
  const dir = await fixture('manifest', sample);
  const m = await createManifest(dir);
  assert.equal(m.fileCount, 3);
  assert.equal(m.files[0].path, 'README.md');
  assert.equal(m.files[0].bytes, 9);
  assert.match(m.files[0].hash, /^[a-f0-9]{64}$/);
  assert.equal(m.totalBytes, m.files.reduce((n, f) => n + f.bytes, 0));
  await rm(dir, { recursive: true, force: true });
});

test('tree hash is independent of file creation order', async () => {
  const a = await fixture('order-a', sample);
  const b = await fixture('order-b', {
    'src/util/strings.mjs': sample['src/util/strings.mjs'],
    'src/index.mjs': sample['src/index.mjs'],
    'README.md': sample['README.md'],
  });
  assert.equal((await createManifest(a)).treeHash, (await createManifest(b)).treeHash);
  await rm(a, { recursive: true, force: true });
  await rm(b, { recursive: true, force: true });
});

test('a bundle reconstructs the tree byte-for-byte', async () => {
  const dir = await fixture('roundtrip', sample);
  const bundle = await exportBundle(dir);
  const target = path.join(await mkdtemp(path.join(tmpdir(), 'forge-out-')), 'repo');
  const result = await importBundle(bundle, target);
  assert.equal(result.ok, true);
  assert.equal(result.treeHash, bundle.treeHash);
  for (const [rel, content] of Object.entries(sample)) {
    assert.equal(await readFile(path.join(target, rel), 'utf8'), content);
  }
  assert.deepEqual(await walkTree(target), [...Object.keys(sample)].sort());
  await rm(dir, { recursive: true, force: true });
  await rm(path.dirname(target), { recursive: true, force: true });
});

test('verify detects a changed byte', async () => {
  const dir = await fixture('changed', sample);
  const m = await createManifest(dir);
  await writeFile(path.join(dir, 'README.md'), '# sample!\n');
  const v = await verifyManifest(dir, m);
  assert.equal(v.ok, false);
  assert.deepEqual(v.changed, ['README.md']);
  assert.equal(v.treeHash === v.expectedTreeHash, false);
  await rm(dir, { recursive: true, force: true });
});

test('verify detects a missing file', async () => {
  const dir = await fixture('missing', sample);
  const m = await createManifest(dir);
  await rm(path.join(dir, 'src/index.mjs'));
  const v = await verifyManifest(dir, m);
  assert.deepEqual(v.missing, ['src/index.mjs']);
  assert.equal(v.ok, false);
  await rm(dir, { recursive: true, force: true });
});

test('verify detects an extra file', async () => {
  const dir = await fixture('extra', sample);
  const m = await createManifest(dir);
  await writeFile(path.join(dir, 'extra.txt'), 'surprise');
  const v = await verifyManifest(dir, m);
  assert.deepEqual(v.extra, ['extra.txt']);
  assert.equal(v.ok, false);
  await rm(dir, { recursive: true, force: true });
});

test('import refuses a tampered payload before writing anything', async () => {
  const dir = await fixture('tamper', sample);
  const bundle = await exportBundle(dir);
  const victim = bundle.files[0];
  victim.data = Buffer.from('tampered!').toString('base64');
  const target = path.join(await mkdtemp(path.join(tmpdir(), 'forge-tamper-')), 'repo');
  await assert.rejects(() => importBundle(bundle, target), (error) => {
    assert.equal(error.code, 'BAD_BUNDLE');
    return true;
  });
  await assert.rejects(() => readFile(path.join(target, 'README.md'), 'utf8'));
  await rm(dir, { recursive: true, force: true });
  await rm(path.dirname(target), { recursive: true, force: true });
});

test('import refuses path traversal', async () => {
  const bundle = {
    schemaVersion: 1,
    kind: 'repo-bundle',
    treeHash: 'x',
    files: [{ path: '../escape.txt', bytes: 1, hash: 'y', data: 'YQ==' }],
  };
  await assert.rejects(() => importBundle(bundle, path.join(tmpdir(), 'never')), (error) => {
    assert.equal(error.code, 'PATH_TRAVERSAL');
    return true;
  });
});

test('import refuses an absolute path', async () => {
  const bundle = {
    schemaVersion: 1,
    kind: 'repo-bundle',
    treeHash: 'x',
    files: [{ path: 'C:/windows/evil.txt', bytes: 1, hash: 'y', data: 'YQ==' }],
  };
  await assert.rejects(() => importBundle(bundle, path.join(tmpdir(), 'never')), (error) => {
    assert.equal(error.code, 'BAD_PATH');
    return true;
  });
});

test('import refuses duplicate paths', async () => {
  const bundle = {
    schemaVersion: 1,
    kind: 'repo-bundle',
    treeHash: 'x',
    files: [
      { path: 'a.txt', bytes: 1, hash: 'y', data: 'YQ==' },
      { path: 'a.txt', bytes: 1, hash: 'y', data: 'YQ==' },
    ],
  };
  await assert.rejects(() => importBundle(bundle, path.join(tmpdir(), 'never')), (error) => {
    assert.equal(error.code, 'DUPLICATE_PATH');
    return true;
  });
});

test('a non-bundle object is refused', async () => {
  await assert.rejects(() => importBundle({ hello: 'world' }, path.join(tmpdir(), 'never')), (error) => {
    assert.equal(error.code, 'BAD_BUNDLE');
    return true;
  });
});

test('an empty directory has a stable hash', async () => {
  const a = await fixture('empty-a', {});
  const b = await fixture('empty-b', {});
  const ma = await createManifest(a);
  const mb = await createManifest(b);
  assert.equal(ma.fileCount, 0);
  assert.equal(ma.treeHash, mb.treeHash);
  await rm(a, { recursive: true, force: true });
  await rm(b, { recursive: true, force: true });
});

test('compareManifests names every difference', async () => {
  const a = await fixture('compare-a', sample);
  const b = await fixture('compare-b', { 'README.md': '# different\n', 'new.txt': 'x' });
  const diff = compareManifests(await createManifest(a), await createManifest(b));
  assert.equal(diff.same, false);
  assert.ok(diff.onlyInA.includes('src/index.mjs'));
  assert.ok(diff.onlyInB.includes('new.txt'));
  assert.deepEqual(diff.differing, ['README.md']);
  await rm(a, { recursive: true, force: true });
  await rm(b, { recursive: true, force: true });
});
