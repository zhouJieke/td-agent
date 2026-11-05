import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { brandSvg } from '../assets/branding'

const root = resolve(import.meta.dirname, '..')
const cli = join(root, 'node_modules/@tauri-apps/cli/tauri.js')

function run(args: string[]) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' })
  if (result.error)
    throw result.error
  if (result.status !== 0)
    throw new Error(`ICON_GENERATION_FAILED: exit ${result.status}`)
}

for (const [file, options] of [
  ['favicon.svg', {}],
  ['deepseek-harness-desktop-tauri.svg', {}],
  ['deepseek-harness-desktop-tauri-nightly.svg', { nightly: true }],
  ['deepseek-harness-desktop-tauri-square.svg', { square: true }],
] as const) {
  writeFileSync(join(root, 'public', file), brandSvg(options))
}
writeFileSync(join(root, 'assets/macos-tray.svg'), brandSvg({ template: true }))

for (const variant of ['stable', 'nightly']) {
  const suffix = variant === 'nightly' ? '-nightly' : ''
  const output = join(root, '.temp/desktop-icons', variant)
  const destination = join(root, 'src-tauri/icons', variant === 'nightly' ? variant : '')
  mkdirSync(destination, { recursive: true })
  run([cli, 'icon', `public/deepseek-harness-desktop-tauri${suffix}.svg`, '--output', output])
  for (const entry of readdirSync(output, { withFileTypes: true })) {
    if (entry.isFile() && /\.(?:png|ico)$/.test(entry.name))
      copyFileSync(join(output, entry.name), join(destination, entry.name))
  }
}
run([join(root, 'node_modules/tsx/dist/cli.mjs'), 'scripts/rebuild-macos-icon.ts'])
