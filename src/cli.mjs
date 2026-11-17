// SPDX-License-Identifier: MIT
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createManifest,
  exportBundle,
  importBundle,
  verifyManifest,
} from './index.mjs';

const [command, a, b] = process.argv.slice(2);

async function demo() {
  const root = await mkdtemp(path.join(tmpdir(), 'forge-demo-'));
  const source = path.join(root, 'source');
  const restored = path.join(root, 'restored');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.join(source, 'src'), { recursive: true });
  await writeFile(path.join(source, 'src', 'hello.mjs'), "export const hello = () => 'hi';\n");
  await writeFile(path.join(source, 'README.md'), '# demo\n\nTwo files, one promise.\n');

  const bundle = await exportBundle(source);
  const result = await importBundle(bundle, restored);
  const check = await verifyManifest(restored, await createManifest(source));
  await rm(root, { recursive: true, force: true });
  return {
    demo: true,
    files: bundle.fileCount,
    treeHash: bundle.treeHash,
    restored: result.ok,
    verify: check.ok,
  };
}

async function main() {
  if (!command) {
    const result = await demo();
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.verify ? 0 : 1;
  }
  if (command === 'manifest') {
    const manifest = await createManifest(a);
    await writeFile(b, JSON.stringify(manifest, null, 2) + '\n');
    process.stdout.write(`wrote ${b} (${manifest.fileCount} files, ${manifest.treeHash})\n`);
    return 0;
  }
  if (command === 'export') {
    const bundle = await exportBundle(a);
    await writeFile(b, JSON.stringify(bundle) + '\n');
    process.stdout.write(`exported ${bundle.fileCount} files to ${b} (tree ${bundle.treeHash})\n`);
    return 0;
  }
  if (command === 'import') {
    const bundle = JSON.parse(await readFile(a, 'utf8'));
    const result = await importBundle(bundle, b);
    process.stdout.write(`restored ${result.fileCount} files to ${b} (tree ${result.treeHash})\n`);
    return 0;
  }
  if (command === 'verify') {
    const manifest = JSON.parse(await readFile(b, 'utf8'));
    const result = await verifyManifest(a, manifest);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.ok ? 0 : 1;
  }
  throw new Error(`unknown command: ${command}`);
}

process.exitCode = await main();
