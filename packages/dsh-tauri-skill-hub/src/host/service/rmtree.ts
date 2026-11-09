import { chmodSync, lstatSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { defineService } from 'dsh-tauri'

const RMTREE_RETRIES = { maxRetries: 10, retryDelay: 200 } as const

export const rmtree = defineService({
  remove(path: string): void {
    if (lstatSync(path, { throwIfNoEntry: false }) === undefined)
      return
    clearReadOnly(path)
    rmSync(path, { recursive: true, force: true, ...RMTREE_RETRIES })
  },
})

function clearReadOnly(path: string): void {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink())
    return
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path, { withFileTypes: true }))
      clearReadOnly(join(path, entry.name))
    chmodSync(path, 0o777)
  }
  else if (stat.isFile()) {
    chmodSync(path, 0o666)
  }
}
