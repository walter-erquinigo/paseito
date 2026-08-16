# Paseito modification notice

Paseito is an independent fork of [Paseo](https://github.com/getpaseo/paseo), maintained by
Walter Erquinigo at <https://github.com/walter-erquinigo/paseito>.

Fork baseline: Paseo `v0.2.5`, peeled commit `6fc491e6220fba6543bbbe4bf1b1f58cfe59228b`.

Modifications begun 2026-08-04:

- a separate macOS product identity, application data directory, daemon home, port, URL scheme,
  CLI name, update source, and original icon;
- a read-only Changes base selector with per-repository and per-branch persistence;
- fail-closed upstream rebase, verification, release, installation, migration, and reporting
  automation for Apple Silicon macOS.

Paseito retains Paseo's upstream copyrights and is distributed under the GNU Affero General
Public License, version 3 or later. See [LICENSE](LICENSE). Internal `@getpaseo/*` package and type
names are intentionally retained where renaming would add rebase risk without changing Paseito's
technical identity.
