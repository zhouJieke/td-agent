import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readManifest } from '../scripts/bundle-metadata.mjs'
import { prepareBundledPnpm } from '../scripts/prepare-pnpm.mjs'

const roots: string[] = []

function fixture(version = '11.7.0') {
  const repo = mkdtempSync(path.join(tmpdir(), 'bundled-pnpm-'))
  roots.push(repo)
  const resources = path.join(repo, 'src-tauri/resources')
  const config = path.join(repo, 'src-tauri/src/config')
  const packed = path.join(repo, 'package')
  mkdirSync(resources, { recursive: true })
  mkdirSync(config, { recursive: true })
  mkdirSync(path.join(packed, 'bin'), { recursive: true })
  writeFileSync(path.join(packed, 'bin/pnpm.cjs'), `console.log(${JSON.stringify(version)})`)
  writeFileSync(path.join(packed, 'LICENSE'), 'test package license')
  writeFileSync(path.join(packed, 'package.json'), JSON.stringify({ name: 'pnpm', version }))
  const file = path.join(repo, 'pnpm.tgz')
  execFileSync('tar', ['-czf', file, '-C', repo, 'package'], { timeout: 10000 })
  const archive = readFileSync(file)
  const constants = readFileSync(new URL('../src-tauri/src/config/constants.rs', import.meta.url), 'utf8')
    .replace(/(pub const PNPM_SHA256:\s*&str\s*=\s*")[^"]+/, `$1${createHash('sha256').update(archive).digest('hex')}`)
  writeFileSync(path.join(config, 'constants.rs'), constants)
  const manifest = {
    dependencies: {
      pnpm: { entry: 'bin/pnpm.cjs', managedRoot: '$AppData/dependencies/pnpm', overridable: true },
      node: { managedRoot: '$AppData/runtime', overridable: true },
      dsh: { managedRoot: '$AppData/dependencies/dsh', overridable: true },
    },
  }
  writeFileSync(path.join(resources, 'manifest.jsonc'), JSON.stringify(manifest))
  mkdirSync(path.join(resources, 'pnpm'))
  writeFileSync(path.join(resources, 'pnpm/previous'), 'existing installation')
  return { repo, resources, archive, manifest }
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe('bundled pnpm preparation', () => {
  it('ships a runnable pnpm and makes packaged resources override previous runtime mappings', async () => {
    const { repo, resources, archive, manifest } = fixture()
    const urls: string[] = []
    const result = await prepareBundledPnpm({ repo, fetchArchive: async (url) => {
      urls.push(url)
      return archive
    } })
    expect(urls).toEqual(['https://tdcunchu.oss-cn-beijing.aliyuncs.com/td-agent/runtime/pnpm/11.7.0/pnpm-11.7.0.tgz'])
    expect(result).toEqual({ version: '11.7.0', root: path.join(resources, 'pnpm') })
    expect(readManifest(repo)).toEqual({
      ...manifest,
      dependencies: { ...manifest.dependencies, pnpm: { entry: 'bin/pnpm.cjs', managedRoot: '$Resources/pnpm', overridable: false } },
    })
    expect(execFileSync(process.execPath, [path.join(result.root, 'bin/pnpm.cjs'), '--version'], { encoding: 'utf8', timeout: 10000 }).trim()).toBe('11.7.0')
    expect(readFileSync(path.join(result.root, 'LICENSE'), 'utf8')).toBe('test package license')
    expect(existsSync(path.join(result.root, 'previous'))).toBe(false)
    expect(readdirSync(resources).sort()).toEqual(['manifest.jsonc', 'pnpm'])
  })

  it.each(['corrupt', 'wrong-version', 'download-failure'])('preserves existing resources and manifest when preparation fails: %s', async (failure) => {
    const { repo, resources, archive, manifest } = fixture(failure === 'wrong-version' ? '10.0.0' : '11.7.0')
    const expected = {
      'corrupt': 'PNPM_BUNDLE_INTEGRITY_FAILED:',
      'wrong-version': 'PNPM_BUNDLE_VERSION_INVALID:',
      'download-failure': 'network unavailable',
    }[failure]
    await expect(prepareBundledPnpm({ repo, fetchArchive: async () => {
      if (failure === 'download-failure')
        throw new Error('network unavailable')
      return failure === 'corrupt' ? Buffer.from('corrupted archive') : archive
    } })).rejects.toThrow(expected)
    expect(readManifest(repo)).toEqual(manifest)
    expect(readFileSync(path.join(resources, 'pnpm/previous'), 'utf8')).toBe('existing installation')
    expect(readdirSync(resources).sort()).toEqual(['manifest.jsonc', 'pnpm'])
  })

  it('prepares pnpm before every standard desktop build', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(pkg.scripts.prebuild).toBe('node scripts/prepare-pnpm.mjs && pnpm build:plugins')
  })
})
