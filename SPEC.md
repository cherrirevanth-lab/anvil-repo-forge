# Rebuild contract — repo-forge

A valid reconstruction passes `test/repo-forge.test.mjs` and satisfies every rule below. The test
file is the oracle.

## 1. File tree

```
20-repo-forge/
├─ package.json            type: module, no dependencies, scripts test/start/verify
├─ src/index.mjs           walkTree, treeHash, createManifest, verifyManifest,
│                          exportBundle, importBundle, compareManifests, ForgeError
├─ src/cli.mjs             no args = demo; manifest|export|import|verify <args>
├─ test/repo-forge.test.mjs 14 acceptance tests
├─ verify.mjs              tests + demo smoke -> evidence.json
├─ permission-manifest.json
├─ .github/workflows/ci.yml
├─ README.md / SPEC.md / SECURITY.md / LICENSE / .gitignore
```

## 2. Canonical form

- Paths are posix, relative, sorted bytewise by code unit, no leading `./`, no backslash.
- `hash = sha256(fileBytes).hex`.
- `treeHash = sha256(join(`\`${path}\\n${hash}\\n\`` for sorted files))`.
- Excluded names by default: `.git`, `node_modules`, `temp`, `.DS_Store`.
- Only regular files are walked. Any other entry throws `UNSUPPORTED_ENTRY`.

## 3. Import algorithm (order matters)

1. Reject unless `schemaVersion === 1`, `kind === 'repo-bundle'`, `files` is an array.
2. First pass: validate every path (`assertRelativeSafe`) and reject duplicates.
   - reject backslash, absolute paths, drive letters, `..` segments, non-canonical paths.
3. Second pass: base64-decode each payload; require `bytes` length and `hash` to match.
4. Only now `rm(dir, {recursive:true, force:true})` and `mkdir(dir, {recursive:true})`.
5. Write each file with its parent directory created.
6. Recompute the manifest; require `treeHash === bundle.treeHash`, else throw
   `TREE_HASH_MISMATCH`. Return `{ok, dir, treeHash, fileCount}`.

A tampered bundle must leave the target directory non-existent or untouched. This is tested.

## 4. Invariants -> owning test

| # | Invariant | Test |
|---|---|---|
| F1 | Walk order is sorted and excludes dependency/VCS dirs | `walkTree returns sorted...` |
| F2 | Manifest byte counts and hashes are exact | `manifest records bytes...` |
| F3 | Tree hash ignores creation order | `tree hash is independent...` |
| F4 | Export/import is byte-identical | `a bundle reconstructs...` |
| F5 | One changed byte is detected | `verify detects a changed byte` |
| F6 | Missing/extra files are named, not just counted | `verify detects a missing file` / `extra file` |
| F7 | Tampered payload is refused before writing | `import refuses a tampered payload...` |
| F8 | `..` cannot escape the target | `import refuses path traversal` |
| F9 | Absolute paths are refused | `import refuses an absolute path` |
| F10 | Duplicate paths are refused | `import refuses duplicate paths` |
| F11 | Non-bundles are refused | `a non-bundle object is refused` |
| F12 | Empty trees hash stably | `an empty directory has a stable hash` |
| F13 | Manifest diff names every difference | `compareManifests names every difference` |

## 5. Boundaries

Not a backup tool: no compression, no incremental transfer, no encryption, no file modes. It proves
tree integrity for source. A 4 GB bundle is a bad idea; refuse one with a documented `TOO_LARGE`
error if you add a size cap, and update this section.

## 6. Rebuild checklist

- [ ] `node --test test/` -> 14 passing.
- [ ] `node src/cli.mjs` exits 0 and prints `"verify": true`.
- [ ] `node verify.mjs` -> `ok: true`.
- [ ] Importing a bundle with a single flipped byte writes nothing.
