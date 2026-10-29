// Assembles build/app: the files packaged into the StockKaro desktop installers.
//   build/app/main.cjs, splash.html, icon.png   Electron entry and start-up screen
//   build/app/server/dist, client/dist          the built web app (run `npm run build` at the root first)
//   build/app/node_modules                      the server's production dependencies
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(desktop, '..');
const out = path.join(desktop, 'build', 'app');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

for (const built of ['server/dist/index.js', 'client/dist/index.html']) {
  if (!fs.existsSync(path.join(root, built))) {
    console.error(`Missing ${built}: run "npm run build" in the repository root first.`);
    process.exit(1);
  }
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const copy = (from, to = from) => fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true });
copy('server/dist');
copy('server/package.json');
copy('client/dist');
fs.copyFileSync(path.join(desktop, 'src', 'main.cjs'), path.join(out, 'main.cjs'));
fs.copyFileSync(path.join(desktop, 'src', 'splash.html'), path.join(out, 'splash.html'));
fs.copyFileSync(path.join(desktop, 'resources', 'icon.png'), path.join(out, 'icon.png'));

// Pin each server dependency to the version the web app was built and tested with.
const rootPkg = readJson(path.join(root, 'package.json'));
const serverPkg = readJson(path.join(root, 'server', 'package.json'));
const installed = (name) => readJson(path.join(root, 'node_modules', name, 'package.json')).version;
const dependencies = Object.fromEntries(Object.keys(serverPkg.dependencies).map((name) => [name, installed(name)]));

fs.writeFileSync(
  path.join(out, 'package.json'),
  `${JSON.stringify(
    {
      name: 'stockkaro',
      productName: 'StockKaro',
      version: rootPkg.version,
      description: 'StockKaro: paper trading, portfolio tracking, IPOs and chart analysis for the Indian stock market.',
      author: { name: 'Ammar Karimi', email: 'ammarkarimi.ai@gmail.com' },
      homepage: 'https://github.com/Ammarkarimi/stock-market-application',
      license: rootPkg.license,
      main: 'main.cjs',
      dependencies,
    },
    null,
    2,
  )}\n`,
);

console.log(`Installing ${Object.keys(dependencies).length} production dependencies...`);
execSync('npm install --omit=dev --no-audit --no-fund --no-package-lock', { cwd: out, stdio: 'inherit' });

// better-sqlite3 ships prebuilt binaries for every platform plus the SQLite sources: keep only this platform's
// binaries (both architectures, for macOS's arm64 and x64 builds).
const sqlite = path.join(out, 'node_modules', 'better-sqlite3');
for (const unused of ['deps', 'src', 'build']) fs.rmSync(path.join(sqlite, unused), { recursive: true, force: true });
for (const file of fs.readdirSync(path.join(sqlite, 'prebuilds'))) {
  if (!file.startsWith(`${process.platform}-`) || file.startsWith('linuxmusl')) fs.rmSync(path.join(sqlite, 'prebuilds', file));
}

console.log(`Staged StockKaro ${rootPkg.version} in ${path.relative(root, out)}`);
