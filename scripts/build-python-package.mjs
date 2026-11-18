// Release preparation only: consumers install a wheel or sdist without Node.
import {execFileSync} from 'node:child_process';
import {cpSync, existsSync, rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, env = {}) => execFileSync(cmd, args, {cwd: root, stdio: 'inherit', env: {...process.env, ...env}});
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {REAKTIV_WORKBOOK_SHARE_BUILD: '1'});
const target = path.join(root, 'python/reaktiv_workbook/web');
rmSync(target, {recursive: true, force: true});
cpSync(path.join(root, 'dist/reaktiv-workbook/browser'), target, {recursive: true, filter: file => !file.endsWith('.map')});
const notices = path.join(root, 'dist/reaktiv-workbook/3rdpartylicenses.txt');
if (!existsSync(notices)) throw new Error('Frontend third-party license notices are missing');
cpSync(notices, path.join(target, '3rdpartylicenses.txt'));
rmSync(path.join(root, 'python/reaktiv_workbook.egg-info'), {recursive: true, force: true});
rmSync(path.join(root, 'build'), {recursive: true, force: true});
run('uv', ['build', '--no-sources', '--out-dir', 'release/python']);
