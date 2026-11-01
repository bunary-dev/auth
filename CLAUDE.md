# @bunary/auth — agent instructions

## Definition of done

A PR that changes anything a user of the package can observe (public API,
types, options, defaults, behaviour, error messages) is not done until, in the
same PR:

- `docs/index.md` documents the change: new exports, options and behaviour get
  a section or an updated example; removed or changed behaviour is corrected
  wherever the docs mention it.
- `README.md` is updated if it covers the changed area.
- `CHANGELOG.md` has an entry under `## [Unreleased]` (Breaking / Added /
  Changed / Fixed), ending with the issue number, e.g. `(#12)`. If there is no
  `## [Unreleased]` section yet, add one above the latest release.

Internal-only changes (tests, refactors with no observable effect, CI) need a
CHANGELOG entry only if they fix a user-visible bug.

### Version bump

Every PR that changes `src/` or anything else that changes the shipped code
(the build, `package.json` exports, dependencies or peer dependencies) must,
in the same PR:

- bump `package.json` `version` by semver from the version on `main`:
  - fixes: patch (`0.2.0` → `0.2.1`);
  - features: minor (`0.2.0` → `0.3.0`);
  - breaking changes: major from 1.0 on; before 1.0 (`0.x`) a breaking change
    bumps the minor (`0.2.0` → `0.3.0`);
  - on a pre-release, bump the pre-release number instead
    (`1.0.0-rc.N` → `1.0.0-rc.N+1`);
- move its CHANGELOG `## [Unreleased]` entries under a new
  `## [<version>] - <YYYY-MM-DD>` heading for that version, leaving an empty
  `## [Unreleased]` section above it.

Why: `Tag release on main` tags every merge with the `package.json` version.
If a shipped change does not bump it, the tag already exists and tag-release
fails on a duplicate tag, even though CI and tests are green.

Docs-only, test-only and CI-only changes (including this file) do not bump the
version.

## Out of scope

No npm publishing and no CI/CD or release workflows: publishing for all
`@bunary/*` packages is on hold until the maintainer says otherwise.
