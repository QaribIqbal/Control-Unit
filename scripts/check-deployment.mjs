import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const targets = [
  { name: 'Netlify', entry: 'netlify/functions/api.ts', outdir: '.netlify/build-check' },
  { name: 'Vercel', entry: 'api/[...path].ts', outdir: '.vercel/build-check' },
];
const forbidden = /(?:^|[/\\])(?:node:sqlite|sqlite|exceljs)(?:[/\\]|$)|(?:^|[/\\])exceljs(?:\.js)?$/i;

for (const target of targets) {
  const outdir = resolve(root, target.outdir);
  await mkdir(outdir, { recursive: true });
  const result = await build({
    absWorkingDir: root,
    entryPoints: [target.entry],
    outdir,
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    metafile: true,
    sourcemap: false,
    write: true,
  });

  const inputs = Object.keys(result.metafile.inputs);
  const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports.map(item => item.path));
  const forbiddenDependencies = [...inputs, ...imports].filter(path => forbidden.test(path));
  const secretInputs = inputs.filter(path => /(?:^|[/\\])\.env(?:\.|$)/i.test(path) && !/(?:^|[/\\])\.env\.example$/i.test(path));
  if (forbiddenDependencies.length) throw new Error(`${target.name} bundle contains forbidden local-storage dependencies: ${forbiddenDependencies.join(', ')}`);
  if (secretInputs.length) throw new Error(`${target.name} bundle includes environment files: ${secretInputs.join(', ')}`);
  console.log(`${target.name} deployment bundle checked: ${target.outdir}`);
}
