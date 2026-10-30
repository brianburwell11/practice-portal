/**
 * Third-party notices for /legal/licenses. Walks the npm packages the browser
 * code imports, and everything they depend on, through package-lock.json, and
 * writes:
 *
 *   src/components/legal/thirdPartyLicenses.json   name, version, license, link (the page's list)
 *   public/third-party-licenses.txt                each package's full license text
 *
 * MIT, BSD and the rest ask that their notice ships with the code; the LGPL
 * also wants the library's source offered, which the page links to. Server
 * packages aren't listed: that code never leaves our servers.
 *
 * `npm run build` runs it first, so a deploy always ships notices that match
 * the lockfile; the committed copies catch up on the next local build.
 *
 *   npm run licenses:gen                       # regenerate by hand
 *   npx tsx scripts/gen-licenses.ts --check    # fail if either file is stale
 */
import fs from 'node:fs';
import path from 'node:path';

/** What `src/` imports from npm. A new import there belongs here too. */
const BROWSER_ROOTS = [
  '@fontsource/hanken-grotesk',
  '@radix-ui/react-slider',
  '@soundtouchjs/audio-worklet',
  '@soundtouchjs/core',
  'jszip',
  'opensheetmusicdisplay',
  'react',
  'react-dom',
  'react-router-dom',
  'zod',
  'zustand',
];

const LIST_FILE = 'src/components/legal/thirdPartyLicenses.json';
const TEXT_FILE = 'public/third-party-licenses.txt';

interface LockEntry {
  version: string;
  license?: string;
  dev?: boolean;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8')).packages as Record<string, LockEntry>;

/** The lockfile path a package resolves to from `from`, as Node would find it. */
function resolve(name: string, from: string): string | null {
  let dir = from;
  for (;;) {
    const candidate = `${dir ? `${dir}/` : ''}node_modules/${name}`;
    if (lock[candidate]) return candidate;
    if (!dir) return null;
    const i = dir.lastIndexOf('/node_modules/');
    dir = i < 0 ? '' : dir.slice(0, i);
  }
}

const seen = new Map<string, LockEntry>();
function walk(lockPath: string): void {
  if (seen.has(lockPath)) return;
  const entry = lock[lockPath];
  seen.set(lockPath, entry);
  for (const dep of Object.keys({ ...entry.dependencies, ...entry.peerDependencies })) {
    const found = resolve(dep, lockPath);
    if (found && !lock[found].dev) walk(found);
  }
}
for (const root of BROWSER_ROOTS) {
  const found = resolve(root, '');
  if (!found) throw new Error(`${root} isn't installed`);
  walk(found);
}

function repoUrl(pkg: { repository?: string | { url?: string }; homepage?: string }, name: string): string {
  const raw = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (raw) {
    const url = raw.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://');
    if (/^https?:\/\//.test(url)) return url;
    if (/^github:|^[\w-]+\/[\w.-]+$/.test(raw)) return `https://github.com/${raw.replace(/^github:/, '')}`;
  }
  return pkg.homepage ?? `https://www.npmjs.com/package/${name}`;
}

function authorOf(pkg: { author?: string | { name?: string } }): string | undefined {
  return typeof pkg.author === 'string' ? pkg.author : pkg.author?.name;
}

/** The MIT license, for packages that declare it but ship no LICENSE file. */
function mitText(holder: string): string {
  return `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
}

const rows: { name: string; version: string; license: string; url: string }[] = [];
const texts: string[] = [];
for (const lockPath of [...seen.keys()].sort()) {
  const name = lockPath.replace(/.*node_modules\//, '');
  // Type declarations are erased at build time: nothing of them ships.
  if (name.startsWith('@types/')) continue;
  const pkg = JSON.parse(fs.readFileSync(path.join(lockPath, 'package.json'), 'utf8'));
  const licenseFile = fs.readdirSync(lockPath).find((f) => /^(licen[cs]e|copying)/i.test(f));
  const license = seen.get(lockPath)!.license ?? pkg.license ?? 'UNKNOWN';
  if (rows.some((r) => r.name === name && r.version === pkg.version)) continue;
  rows.push({ name, version: pkg.version, license, url: repoUrl(pkg, name) });
  texts.push([
    '='.repeat(78),
    `${name} ${pkg.version}  (${license})`,
    repoUrl(pkg, name),
    '='.repeat(78),
    '',
    licenseFile
      ? fs.readFileSync(path.join(lockPath, licenseFile), 'utf8').trim()
      : license === 'MIT'
        ? mitText(authorOf(pkg) ?? `the ${name} authors (${repoUrl(pkg, name)})`)
        : `No license file ships with this package. Its package.json declares: ${license}.`,
    '',
  ].join('\n'));
}

const list = `${JSON.stringify(rows, null, 2)}\n`;
const text = [
  'Third-party software in Practice Portal',
  '',
  'The code your browser runs on practiceportal.app includes the open source',
  'packages below. Each is listed with its license, as its authors require.',
  'See https://practiceportal.app/legal/licenses',
  '',
  ...texts,
].join('\n');

if (process.argv.includes('--check')) {
  const stale = [[LIST_FILE, list], [TEXT_FILE, text]]
    .filter(([file, want]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== want)
    .map(([file]) => file);
  if (stale.length) {
    console.error(`Stale: ${stale.join(', ')}. Run: npx tsx scripts/gen-licenses.ts`);
    process.exit(1);
  }
  console.log(`Third-party notices are current (${rows.length} packages).`);
} else {
  fs.writeFileSync(LIST_FILE, list);
  fs.writeFileSync(TEXT_FILE, text);
  console.log(`Wrote ${rows.length} packages to ${LIST_FILE} and ${TEXT_FILE}.`);
}
