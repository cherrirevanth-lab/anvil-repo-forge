# repo-forge

A repository that can prove it is reconstructable: export the whole tree as one JSON bundle, import
it anywhere, and compare a single SHA-256 tree hash. If the hash matches, the bytes match.

```
$ node src/cli.mjs export . repo.bundle.json
exported 101 files to repo.bundle.json (tree 4f1c...)

$ node src/cli.mjs import repo.bundle.json ../copy
restored 101 files to ../copy (tree 4f1c...)
```

## Why

"Reconstructable" usually means "there is a README". That is a promise, not a proof. This makes it
mechanical: a sorted path list, a per-file hash, one tree hash over the pair, and an importer that
refuses to write a single byte until every payload hash verifies. Path traversal, absolute paths and
duplicates are rejected before the target directory is touched.

## Quickstart

```sh
node --test test/          # 14 tests
node src/cli.mjs           # export -> import -> verify demo
node verify.mjs            # writes evidence.json
```

```js
import { exportBundle, importBundle } from './src/index.mjs';

const bundle = await exportBundle('./my-repo');
await importBundle(bundle, './restored'); // byte-identical or throws
```

## Contract

| Function | Returns |
|---|---|
| `walkTree(dir, {exclude})` | sorted posix-relative regular-file paths |
| `createManifest(dir)` | `{schemaVersion, algorithm, fileCount, totalBytes, treeHash, files:[{path,bytes,hash}]}` |
| `treeHash(files)` | SHA-256 over sorted `path\\nhash\\n` lines |
| `verifyManifest(dir, manifest)` | `{ok, treeHash, expectedTreeHash, missing, changed, extra}` |
| `exportBundle(dir)` | `{schemaVersion:1, kind:'repo-bundle', treeHash, files:[{...,data:base64}]}` |
| `importBundle(bundle, dir)` | writes only after all hashes verify; throws typed `ForgeError` |
| `compareManifests(a, b)` | `{same, onlyInA, onlyInB, differing}` |

Error codes: `BAD_PATH`, `PATH_TRAVERSAL`, `DUPLICATE_PATH`, `BAD_BUNDLE`, `TREE_HASH_MISMATCH`,
`NOT_A_DIRECTORY`, `UNSUPPORTED_ENTRY`.

Excluded by default: `.git`, `node_modules`, `temp`, `.DS_Store`.

## Limits

- Bundles are JSON with base64, so they are ~1.33x the tree size. Fine for source repos, wrong for
  binaries over a few hundred MB.
- Symlinks and special files are refused, not followed. That is deliberate: following them is how
  archive importers escape their directory.
- File modes and empty directories are not preserved. For source repos this is irrelevant; for
  executables it matters, and this tool is honest about it.
- No signature. The hash proves integrity against a manifest you trust, not authorship. Sign the
  tree hash with `ssh-keygen -Y sign` if you need provenance.

## Permissions

No network, no secrets, no environment. Reads and writes only the directories you pass. CI requests
`contents: read`. See `permission-manifest.json`.

## License

MIT © 2026 Revan
