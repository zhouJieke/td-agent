import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const cli = join(root, 'node_modules/@tauri-apps/cli/tauri.js')

function run(args: string[]) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' })
  if (result.error)
    throw result.error
  if (result.status !== 0)
    throw new Error(`ICON_GENERATION_FAILED: exit ${result.status}`)
}

for (const file of [
  'favicon.svg',
  'deepseek-harness-desktop-tauri.svg',
  'deepseek-harness-desktop-tauri-nightly.svg',
  'deepseek-harness-desktop-tauri-square.svg',
]) {
  copyFileSync(join(root, 'assets/brand-logo.svg'), join(root, 'public', file))
}

const uiOutput = join(root, '.temp/desktop-icons/ui')
run([cli, 'icon', 'public/favicon.svg', '--output', uiOutput, '--png', '512'])
copyFileSync(join(uiOutput, '512x512.png'), join(root, 'assets/brand-mark.png'))

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
