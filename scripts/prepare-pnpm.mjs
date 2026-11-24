import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { readBuildConstants, readManifest } from './bundle-metadata.mjs'

export async function prepareBundledPnpm({ repo = process.cwd(), fetchArchive = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok)
    throw new Error(`PNPM_BUNDLE_DOWNLOAD_FAILED: HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
} } = {}) {
  const constants = readBuildConstants(repo)
  const source = readFileSync(path.join(repo, 'src-tauri/src/config/constants.rs'), 'utf8')
  const base = source.match(/pub const RUNTIME_DOWNLOAD_BASE_URL:\s*&str\s*=\s*"([^"]+)"/)?.[1]
  if (!base)
    throw new Error('PNPM_BUNDLE_CONFIG_INVALID: missing runtime download base URL')
  const manifest = readManifest(repo)
  if (!manifest.dependencies?.pnpm)
    throw new Error('PNPM_BUNDLE_CONFIG_INVALID: missing pnpm dependency')
  const archive = await fetchArchive(`${base}/runtime/pnpm/${constants.pnpmVersion}/pnpm-${constants.pnpmVersion}.tgz`)
  if (createHash('sha256').update(archive).digest('hex') !== constants.pnpmSha256)
    throw new Error('PNPM_BUNDLE_INTEGRITY_FAILED: archive SHA-256 mismatch')
  const resources = path.join(repo, 'src-tauri/resources')
  mkdirSync(resources, { recursive: true })
  const temporary = mkdtempSync(path.join(resources, '.pnpm-'))
  try {
    const tarball = path.join(temporary, 'pnpm.tgz')
    const extracted = path.join(temporary, 'pnpm')
    writeFileSync(tarball, archive)
    mkdirSync(extracted)
    execFileSync('tar', ['-xzf', tarball, '--strip-components=1', '-C', extracted], { timeout: 120_000 })
    const version = execFileSync(process.execPath, [path.join(extracted, 'bin/pnpm.cjs'), '--version'], {
      encoding: 'utf8',
      timeout: 30_000,
      cwd: temporary,
      env: { ...process.env, NODE_OPTIONS: '' },
    }).trim()
    if (version !== constants.pnpmVersion)
      throw new Error(`PNPM_BUNDLE_VERSION_INVALID: expected ${constants.pnpmVersion}, got ${version}`)
    rmSync(path.join(resources, 'pnpm'), { recursive: true, force: true })
    renameSync(extracted, path.join(resources, 'pnpm'))
    manifest.dependencies.pnpm.managedRoot = '$Resources/pnpm'
    manifest.dependencies.pnpm.overridable = false
    writeFileSync(path.join(resources, 'manifest.jsonc'), `${JSON.stringify(manifest, null, 2)}\n`)
    return { version, root: path.join(resources, 'pnpm') }
  }
  finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { version, root } = await prepareBundledPnpm()
    console.log(`Bundled pnpm ${version}: ${root}`)
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
