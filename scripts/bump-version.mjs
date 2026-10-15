// Bumps the release version across every manifest and creates the matching tag.
//
//   node scripts/bump-version.mjs 0.2.0
//
// Why the bump is committed before the tag is created: tauri-action derives
// `tagName: v__VERSION__` from `tauri.conf.json`, so the tag has to point at a
// commit that already carries the new version. Tag first and the action would
// resolve the *old* version, find the previous release and overwrite its assets.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TAURI_CONF = "src-tauri/tauri.conf.json";
const PACKAGE_JSON = "package.json";
const CARGO_TOML = "src-tauri/Cargo.toml";
const CARGO_LOCK = "src-tauri/Cargo.lock";

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const write = (rel, text) => fs.writeFileSync(path.join(root, rel), text);

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** Run git, returning null instead of throwing when the command fails. */
function gitOrNull(...args) {
  try {
    return git(...args);
  } catch {
    return null;
  }
}

/** Parse `x.y.z` with an optional `-prerelease`, or return null. */
function parseVersion(value) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value).trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || "" };
}

function compareVersions(a, b) {
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (a.pre === b.pre) return 0;
  if (a.pre === "") return 1;
  if (b.pre === "") return -1;
  return a.pre < b.pre ? -1 : 1;
}

/** Replace the value of a `"version": "..."` key, preserving all formatting. */
function bumpJsonVersion(rel, text, next) {
  const pattern = /^(\s*"version"\s*:\s*")([^"]*)(")/m;
  if (!pattern.test(text)) fail(`${rel}: no top-level "version" key found`);
  return text.replace(pattern, (_m, prefix, _current, suffix) => prefix + next + suffix);
}

/**
 * Replace `version` inside the `[package]` section only, so entries in
 * `[dependencies]` are left untouched.
 */
function bumpCargoToml(text, next) {
  const header = "[package]";
  const start = text.indexOf(header);
  if (start < 0) fail(`${CARGO_TOML}: no [package] section found`);
  const bodyStart = start + header.length;
  const nextSection = text.slice(bodyStart).search(/^\[/m);
  const bodyEnd = nextSection < 0 ? text.length : bodyStart + nextSection;
  const section = text.slice(0, bodyEnd);
  if (!/^version\s*=\s*"/m.test(section)) fail(`${CARGO_TOML}: no version key in [package]`);

  const bumped = section.replace(/^(version\s*=\s*")([^"]*)(")/m, (_m, prefix, _current, suffix) => prefix + next + suffix);
  return bumped + text.slice(bodyEnd);
}

/** Keep the lockfile in step without shelling out to cargo. */
function bumpCargoLock(text, crateName, next) {
  const pattern = new RegExp(`(name = "${crateName}"\\r?\\nversion = ")([^"]*)(")`);
  if (!pattern.test(text)) fail(`${CARGO_LOCK}: no entry for "${crateName}"`);
  return text.replace(pattern, (_m, prefix, _current, suffix) => prefix + next + suffix);
}

/* ------------------------------------------------------------------ */

const next = process.argv[2];
if (!next) fail("usage: node scripts/bump-version.mjs <x.y.z>");

const nextParsed = parseVersion(next);
if (!nextParsed) fail(`"${next}" is not a valid version; expected something like 0.2.0 or 0.2.0-beta.1`);

const tauriConf = read(TAURI_CONF);
const current = /^\s*"version"\s*:\s*"([^"]*)"/m.exec(tauriConf)?.[1];
if (!current) fail(`${TAURI_CONF}: no top-level "version" key found`);

const currentParsed = parseVersion(current);
if (currentParsed && compareVersions(nextParsed, currentParsed) <= 0) {
  fail(`new version ${next} must be greater than the current ${current}`);
}

// Untracked files are harmless (the bump commit only stages the four manifests),
// but an uncommitted edit to a tracked file would end up outside the tagged
// commit, so the release would silently not contain it.
const status = git("status", "--porcelain", "--untracked-files=no");
if (status) {
  fail("you have uncommitted changes to tracked files; commit or stash them first\n" + status);
}

const tag = `v${next}`;
if (gitOrNull("rev-parse", "--verify", "--quiet", `refs/tags/${tag}`)) {
  fail(`tag ${tag} already exists`);
}

const cargoToml = bumpCargoToml(read(CARGO_TOML), next);
const crateName = /^name\s*=\s*"([^"]+)"/m.exec(cargoToml)?.[1] ?? "ofdreader";

write(TAURI_CONF, bumpJsonVersion(TAURI_CONF, tauriConf, next));
write(PACKAGE_JSON, bumpJsonVersion(PACKAGE_JSON, read(PACKAGE_JSON), next));
write(CARGO_TOML, cargoToml);
write(CARGO_LOCK, bumpCargoLock(read(CARGO_LOCK), crateName, next));

// Guard against a silent regex miss on any of the four files.
for (const rel of [TAURI_CONF, PACKAGE_JSON]) {
  const found = /^\s*"version"\s*:\s*"([^"]*)"/m.exec(read(rel))?.[1];
  if (found !== next) fail(`${rel}: expected version ${next}, found ${found}`);
}
for (const rel of [CARGO_TOML, CARGO_LOCK]) {
  if (!read(rel).includes(`version = "${next}"`)) fail(`${rel}: expected version ${next}`);
}

git("add", TAURI_CONF, PACKAGE_JSON, CARGO_TOML, CARGO_LOCK);
git("commit", "-m", `release: v${next}`);
git("tag", tag);

console.log(`bumped ${current} -> ${next} in:`);
for (const rel of [TAURI_CONF, PACKAGE_JSON, CARGO_TOML, CARGO_LOCK]) console.log(`  ${rel}`);
console.log(`\ncommitted and tagged ${tag}. Next:\n  git push origin main ${tag}`);
