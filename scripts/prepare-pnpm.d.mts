export function prepareBundledPnpm(options?: {
  repo?: string
  fetchArchive?: (url: string) => Promise<Uint8Array>
}): Promise<{ version: string, root: string }>
