import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const temp = join(root, '.temp', 'icons')
const cli = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')

function generate(source: string, output: string) {
  mkdirSync(output, { recursive: true })
  const result = spawnSync(process.execPath, [cli, 'icon', source, '--output', output], {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.error)
    throw result.error
  if (result.status !== 0)
    throw new Error(`ICON_GENERATION_FAILED: ${relative(root, source)} (exit ${result.status})`)
}

for (const [source, output] of [
  ['deepseek-harness-desktop-tauri.svg', ''],
  ['deepseek-harness-desktop-tauri-nightly.svg', 'nightly'],
]) {
  const work = join(temp, output || 'stable')
  mkdirSync(work, { recursive: true })
  const svg = readFileSync(join(root, 'public', source), 'utf8')
    .replace('<svg ', '<svg x="100" y="100" width="824" height="824" ')
  const master = join(work, 'macos.svg')
  writeFileSync(master, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${svg}</svg>\n`)
  generate(master, work)
  copyFileSync(join(work, 'icon.icns'), join(root, 'src-tauri', 'icons', output, 'icon.icns'))
}

const tray = join(temp, 'tray')
generate(join(root, 'assets', 'macos-tray.svg'), tray)
copyFileSync(join(tray, '128x128@2x.png'), join(root, 'src-tauri', 'icons', 'macos-tray.png'))
console.log('Rebuilt stable/nightly macOS icons and tray template')
