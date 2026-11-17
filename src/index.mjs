// SPDX-License-Identifier: MIT
/**
 * repo-forge — one repository in, one verifiable bundle out, byte-identical
 * reconstruction back. The hash is the promise.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_EXCLUDES = Object.freeze(['.git', 'node_modules', 'temp', '.DS_Store']);

export class ForgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ForgeError';
    this.code = code;
  }
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function assertRelativeSafe(rel) {
  if (typeof rel !== 'string' || rel.length === 0) {
    throw new ForgeError('BAD_PATH', 'path must be a non-empty string');
  }
  if (rel.includes('\\')) throw new ForgeError('BAD_PATH', `backslash in path: ${rel}`);
  if (path.posix.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) {
    throw new ForgeError('BAD_PATH', `absolute path: ${rel}`);
  }
  const normalized = path.posix.normalize(rel);
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new ForgeError('PATH_TRAVERSAL', `path escapes root: ${rel}`);
  }
  if (normalized !== rel) throw new ForgeError('BAD_PATH', `path not canonical: ${rel}`);
  return normalized;
}

/** @returns {Promise<string[]>} sorted posix-relative file paths */
export async function walkTree(dir, { exclude = DEFAULT_EXCLUDES } = {}) {
  const root = path.resolve(dir);
  const out = [];
  async function walk(abs, rel) {
    const entries = await readdir(abs, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (exclude.includes(entry.name)) continue;
      const childAbs = path.join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(childAbs, childRel);
      else if (entry.isFile()) out.push(childRel);
      else throw new ForgeError('UNSUPPORTED_ENTRY', `not a regular file: ${childRel}`);
    }
  }
  const info = await stat(root).catch(() => null);
  if (!info || !info.isDirectory()) throw new ForgeError('NOT_A_DIRECTORY', `not a directory: ${dir}`);
  await walk(root, '');
  return out.sort();
}

export function treeHash(files) {
  const lines = files
    .map((f) => `${f.path}\n${f.hash}\n`)
    .sort();
  return sha256(lines.join(''));
}

export async function createManifest(dir, { exclude = DEFAULT_EXCLUDES } = {}) {
  const paths = await walkTree(dir, { exclude });
  const files = [];
  for (const rel of paths) {
    const bytes = await readFile(path.join(dir, rel));
    files.push({ path: rel, bytes: bytes.length, hash: sha256(bytes) });
  }
  return {
    schemaVersion: 1,
    algorithm: 'sha256',
    fileCount: files.length,
    totalBytes: files.reduce((n, f) => n + f.bytes, 0),
    treeHash: treeHash(files),
    files,
  };
}

export async function verifyManifest(dir, manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) {
    throw new ForgeError('BAD_MANIFEST', 'unsupported manifest');
  }
  const expected = new Map(manifest.files.map((f) => [assertRelativeSafe(f.path), f]));
  const actualPaths = await walkTree(dir);
  const actual = new Set(actualPaths);
  const missing = [];
  const changed = [];
  for (const [rel, want] of expected) {
    if (!actual.has(rel)) {
      missing.push(rel);
      continue;
    }
    const bytes = await readFile(path.join(dir, rel));
    const got = sha256(bytes);
    if (got !== want.hash || bytes.length !== want.bytes) changed.push(rel);
  }
  const extra = actualPaths.filter((p) => !expected.has(p));
  const computed = await createManifest(dir);
  return {
    ok: missing.length === 0 && changed.length === 0 && extra.length === 0,
    treeHash: computed.treeHash,
    expectedTreeHash: manifest.treeHash,
    missing,
    changed,
    extra,
  };
}

export async function exportBundle(dir, { exclude = DEFAULT_EXCLUDES } = {}) {
  const manifest = await createManifest(dir, { exclude });
  const files = [];
  for (const entry of manifest.files) {
    const bytes = await readFile(path.join(dir, entry.path));
    files.push({ ...entry, data: bytes.toString('base64') });
  }
  return {
    schemaVersion: 1,
    kind: 'repo-bundle',
    algorithm: 'sha256',
    treeHash: manifest.treeHash,
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
    files,
  };
}

export async function importBundle(bundle, dir) {
  if (!bundle || bundle.schemaVersion !== 1 || bundle.kind !== 'repo-bundle' || !Array.isArray(bundle.files)) {
    throw new ForgeError('BAD_BUNDLE', 'not a repo bundle');
  }
  const seen = new Set();
  const safe = [];
  for (const file of bundle.files) {
    const rel = assertRelativeSafe(file.path);
    if (seen.has(rel)) throw new ForgeError('DUPLICATE_PATH', `duplicate path: ${rel}`);
    seen.add(rel);
    safe.push({ ...file, path: rel });
  }
  for (const file of safe) {
    if (typeof file.data !== 'string') throw new ForgeError('BAD_BUNDLE', `missing data: ${file.path}`);
    const bytes = Buffer.from(file.data, 'base64');
    if (bytes.length !== file.bytes) throw new ForgeError('BAD_BUNDLE', `size mismatch: ${file.path}`);
    if (sha256(bytes) !== file.hash) throw new ForgeError('BAD_BUNDLE', `hash mismatch: ${file.path}`);
  }
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const file of safe) {
    const target = path.join(dir, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(file.data, 'base64'));
  }
  const written = await createManifest(dir);
  if (written.treeHash !== bundle.treeHash) {
    throw new ForgeError('TREE_HASH_MISMATCH', `expected ${bundle.treeHash}, got ${written.treeHash}`);
  }
  return { ok: true, dir, treeHash: written.treeHash, fileCount: written.fileCount };
}

export function compareManifests(a, b) {
  const left = new Map(a.files.map((f) => [f.path, f.hash]));
  const right = new Map(b.files.map((f) => [f.path, f.hash]));
  return {
    same: a.treeHash === b.treeHash,
    onlyInA: [...left.keys()].filter((p) => !right.has(p)).sort(),
    onlyInB: [...right.keys()].filter((p) => !left.has(p)).sort(),
    differing: [...left.keys()].filter((p) => right.has(p) && left.get(p) !== right.get(p)).sort(),
  };
}
