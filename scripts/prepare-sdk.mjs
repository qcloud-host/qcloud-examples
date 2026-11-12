import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const {typescript: source} = JSON.parse(readFileSync(join(root, 'sdk-sources.json'), 'utf8'));
const directory = join(root, '.vendor', 'qcloud-typescript');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script with npm run prepare:sdk.');
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {cwd, stdio: 'inherit', windowsHide: true});
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${command} exited ${result.status}`);
}
if (!existsSync(directory)) {
  mkdirSync(join(root, '.vendor'), {recursive: true});
  run('git', ['clone', '--no-checkout', source.repository, directory]);
}
// Do not reset or discard local SDK edits on a repeated setup run.
const status = spawnSync('git', ['status', '--porcelain'], {cwd: directory, encoding: 'utf8', windowsHide: true});
if (status.status !== 0) throw new Error('The SDK checkout is unavailable.');
const head = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {cwd: directory, encoding: 'utf8', windowsHide: true});
if (existsSync(join(directory, 'package.json')) && status.stdout.trim()) throw new Error('The SDK checkout has local changes. Review them before rerunning setup.');
if (head.stdout.trim() !== source.revision || !existsSync(join(directory, 'package.json'))) run('git', ['checkout', source.revision], directory);
run(process.execPath, [npmCli, 'ci'], directory);
run(process.execPath, [npmCli, 'run', 'build'], directory);
console.log('Pinned QCloud SDK built. Run npm ci in the examples repository next.');
