# CLI: Skills

Remote skill management commands install/update/remove GitHub-hosted multi-file skill bundles.

## Commands

- `hiboss skill add-remote --name <skill-name> --source <url> (--agent <name> | --project-id <id>) [--ref <git-ref>] [--token <token>]`
- `hiboss skill list-remote (--agent <name> | --project-id <id>) [--token <token>]`
- `hiboss skill update-remote --name <skill-name> (--agent <name> | --project-id <id>) [--source <url>] [--ref <git-ref>] [--token <token>]`
- `hiboss skill remove-remote --name <skill-name> (--agent <name> | --project-id <id>) [--token <token>]`

## Rules

- Exactly one target selector is required: `--agent` or `--project-id`.
- `--source` must be HTTPS and hosted on `github.com` or `raw.githubusercontent.com`.
- If `--ref` is omitted, the URL ref is used; otherwise the override ref is used.
- Installed remote skill metadata is stored in `<skill-dir>/.source.json`.
- Safety limits are enforced during install/update:
  - max files: `200`
  - max single file size: `512 KiB`
  - max total package size: `5 MiB`
- On failure, RPC/web responses may include structured `errorCode` and `hint` for troubleshooting.

## Output Keys

`add-remote` / `update-remote`:

- `added:` / `updated:`
- `target-type:`
- `target-id:`
- `skill-name:`
- `source-url:`
- `source-ref:`
- `source-path:`
- `repository-url:`
- `commit:`
- `checksum:`
- `file-count:`
- `status:`
- `added-at:`
- `last-updated:`
- `refresh-count:`
- `refresh-targets:`

`list-remote`:

- `target-type:`
- `target-id:`
- `remote-skill-count:`
- `no-remote-skills:` (when empty)
- per-skill keys: same as add/update block (except `added:` / `updated:`)

`remove-remote`:

- `removed:`
- `target-type:`
- `target-id:`
- `skill-name:`
- `refresh-count:`
- `refresh-targets:`
