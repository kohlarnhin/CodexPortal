---
name: codex-portal-release
description: Project-specific development, versioning, and release workflow for /Users/zhujiangyong/Software/codex-portal. Use whenever Codex changes this React/Tauri repository, implements account or configuration features, updates the application version, prepares a release, or is explicitly asked to publish a Codex Portal version.
---

# Codex Portal Development and Release

## Scope

Apply this workflow only inside `/Users/zhujiangyong/Software/codex-portal`.

Treat saved `auth.json` content, tokens, account email addresses, and the local SQLite database as secrets. Never print real credential content, read the user's live `~/.codex/auth.json` merely to inspect its shape, or place credentials in source, fixtures, logs, screenshots, or tool output.

## Start Work

1. Inspect the current branch and worktree with `git status --short` before editing.
2. Preserve all existing user changes and avoid unrelated rewrites.
3. Resolve implementation details from the repository when the requested behavior is sufficiently determined. Ask one concise question only when different interpretations would materially change behavior.
4. Keep React UI changes consistent with the existing compact monochrome desktop design and keep Tauri commands and data access in `src-tauri/src/lib.rs`.

Do not create or switch branches, commit, push, tag, or open a pull request unless the user asks for that Git operation.

## Implement Changes

- Keep frontend pages and components in `src/`, shared hooks in `src/hooks/`, utilities in `src/utils/`, and account types in `src/types/`.
- Preserve raw account and authentication data. Apply masking or formatting only at the presentation boundary unless the user explicitly requests a data migration.
- Prefer browser-native APIs and existing dependencies. Do not install packages merely for small parsing, formatting, or state-persistence tasks.
- Persist application-only UI preferences separately from Codex's `config.toml`; do not mix portal preferences into the user's Codex configuration.
- Do not start services, run tests, build, package, install dependencies, deploy, modify unrelated configuration, or update documentation without explicit user authorization.
- Use read-only inspection, `git diff --check`, and focused diff review as the default verification path.

## Update the Application Version

Keep the application version synchronized in all five sources:

- `package.json`
- `package-lock.json` at both the root version and `packages[""]` version
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- the `codex-portal` package entry in `src-tauri/Cargo.lock`

When the user requests the next version without naming it, increment the patch component by exactly one. When the user gives an explicit version, use it unchanged. Do not update dependency versions as part of an application version bump.

A version bump is development work only. It never authorizes a release.

## Release Gate

Publish only when the user explicitly asks to **发布版本** or gives another unmistakable instruction to publish the current application version. Do not infer release authorization from a version number, completed implementation, approval of the code, or a request to prepare release files.

Without explicit release authorization, do not:

- dispatch `.github/workflows/release.yml`
- create or push a tag
- create, edit, or publish a GitHub Release
- push commits or branches
- build local release artifacts

## Publish an Authorized Release

After explicit release authorization:

1. Verify that the five version sources match and that the target version is not already released.
2. Confirm the intended changes are committed on and pushed to `main`; request any missing Git authorization instead of assuming it.
3. Prepare concise release notes from the actual diff and obtain the user's wording when their choice would materially affect the public notes.
4. Dispatch the manual workflow on `main`:
   ```bash
   gh workflow run release.yml --ref main -f release_notes='<release notes>'
   ```
5. Monitor the corresponding run through completion with `gh run list` and `gh run watch --exit-status`.
6. Let the workflow create `v<version>`, build both macOS architectures, upload the DMG files, and publish the GitHub Release. Do not create a competing manual tag or release.
7. Report the version, commit, workflow result, tag, and release URL.
