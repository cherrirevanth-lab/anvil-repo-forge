# Security

## Threat model

The untrusted input is a repository tree and, on import, a bundle from elsewhere. An archive
importer is a classic path-traversal target, so path validation happens before any write.

Mitigations:

- absolute paths, drive letters, backslashes, `..` segments and non-canonical paths are refused;
- duplicate paths are refused;
- every payload is hash-checked before the target directory is removed or created;
- symlinks and special files are refused rather than followed;
- the tree hash must match after writing, or the import reports failure.

## Known limits

No signature, so this proves integrity against a manifest, not authorship. No size cap yet; a
hostile bundle can consume disk proportional to its own size. Run it on a directory you are willing
to have replaced: import starts by deleting the target.

## Reporting

Open a private security advisory on the repository.
