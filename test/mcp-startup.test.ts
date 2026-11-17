import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { compileFunction } from 'node:vm'
import * as sdk from '@modelcontextprotocol/client'
import { describe, expect, it } from 'vitest'

const rust = readFileSync(new URL('../src-tauri/src/service/patch/mcp_startup.rs', import.meta.url), 'utf8')
const readySource = /const READY_PATCHED: &str = r#"([\s\S]*?)"#;/.exec(rust)?.[1]
if (!readySource)
  throw new Error('MCP readiness patch source is missing')

interface Outcome { error?: Error }

function activate(ready: Promise<Outcome>, failOnStartupError = false, logError = (_error: string) => {}): Promise<void> {
  const apply = compileFunction(`return (async () => {
${readySource}
if (outcome.error !== undefined && config.failOnStartupError)
  throw new Error('initial connection or tool synchronization failed', { cause: outcome.error });
})()`, ['connection', 'config', 'ctx'])
  return apply({ ready }, { failOnStartupError, serverName: 'test' }, { logger: { error: logError } }) as Promise<void>
}

describe('mcp startup readiness', () => {
  it('activates a non-strict MCP while its initial connection is still pending', async () => {
    const ready = Promise.withResolvers<Outcome>()
    let activated = false
    const activation = activate(ready.promise).then(() => {
      activated = true
    })
    await new Promise<void>(resolve => queueMicrotask(resolve))
    try {
      expect(activated).toBe(true)
    }
    finally {
      ready.resolve({})
      await activation
    }
  })

  it('logs an unexpected background rejection without failing activation', async () => {
    const ready = Promise.withResolvers<Outcome>()
    const errors: string[] = []
    await activate(ready.promise, false, error => errors.push(error))
    ready.reject(new Error('transport construction failed'))
    await new Promise<void>(resolve => queueMicrotask(resolve))
    expect(errors).toEqual(['mcp-client(test): background startup failed: Error: transport construction failed'])
  })

  it('keeps explicit strict startup pending until discovery succeeds', async () => {
    const ready = Promise.withResolvers<Outcome>()
    let activated = false
    const activation = activate(ready.promise, true).then(() => {
      activated = true
    })
    await new Promise<void>(resolve => queueMicrotask(resolve))
    expect(activated).toBe(false)
    ready.resolve({})
    await activation
    expect(activated).toBe(true)
  })

  it('preserves the original connection failure as the strict startup error cause', async () => {
    const error = new Error('MCP unavailable')
    await expect(activate(Promise.resolve({ error }), true)).rejects.toMatchObject({
      message: 'initial connection or tool synchronization failed',
      cause: error,
    })
  })
})

describe('mcp HTTP protocol negotiation', () => {
  const connectSource = /const CONNECT_PATCHED: &str = r#"([\s\S]*?)"#;/.exec(rust)?.[1]
  if (!connectSource)
    throw new Error('MCP connection patch source is missing')
  const connect = compileFunction(`return (async () => { ${connectSource} })()`, ['generation', 'transport', 'createTransport', 'config', 'ctx', 'disposed', 'desktopMcpSdk'])

  async function fixture(probeStatus = 500, initializationStatus = 200) {
    const requests: { method: string, authorization?: string }[] = []
    const server = createServer(async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      let body = ''
      for await (const chunk of req)
        body += chunk
      const message = JSON.parse(body)
      requests.push({ method: message.method, authorization: req.headers.authorization })
      if (message.method === 'notifications/initialized') {
        res.writeHead(202).end()
        return
      }
      const status = message.method === 'server/discover' ? probeStatus : message.method === 'initialize' ? initializationStatus : 200
      const result = message.method === 'server/discover'
        ? { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } }
        : message.method === 'initialize'
          ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'coffee-fixture', version: '1' } }
          : { tools: [{ name: 'queryShopList', inputSchema: { type: 'object' } }] }
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(status === 200
        ? { jsonrpc: '2.0', id: message.id, result }
        : { error: 'unsupported request' }))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('Missing fixture port')
    const config = { transport: 'streamable-http', url: `http://127.0.0.1:${address.port}/mcp`, headers: { Authorization: 'Bearer fixture-only' } }
    const transports: sdk.StreamableHTTPClientTransport[] = []
    const createTransport = () => {
      const transport = new sdk.StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } })
      transports.push(transport)
      return transport
    }
    const client = new sdk.Client({ name: 'dsh-mcp-client', version: 'test' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } })
    return {
      requests,
      client,
      transports,
      connect: (disposed = false) => connect(client, createTransport(), createTransport, config, { credentials: {} }, disposed, sdk),
      async close() {
        await client.close()
        await Promise.all(transports.map(transport => transport.close()))
        await new Promise<void>((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve())
          server.closeAllConnections()
        })
      },
    }
  }

  it('loads tools with preserved credentials when an older HTTP server rejects discovery with 500', async () => {
    const local = await fixture()
    try {
      await local.connect()
      expect((await local.client.listTools()).tools.map(tool => tool.name)).toEqual(['queryShopList'])
      expect(local.requests).toEqual(['server/discover', 'initialize', 'notifications/initialized', 'tools/list'].map(method => ({ method, authorization: 'Bearer fixture-only' })))
      expect(local.transports).toHaveLength(2)
    }
    finally {
      await local.close()
    }
  })

  it.each([401, 403, 503])('preserves discovery HTTP %i errors without trying another handshake', async (status) => {
    const local = await fixture(status)
    try {
      await expect(local.connect()).rejects.toMatchObject({ status })
      expect(local.requests.map(request => request.method)).toEqual(['server/discover'])
      expect(local.transports).toHaveLength(1)
    }
    finally {
      await local.close()
    }
  })

  it('keeps successful modern discovery without falling back to initialize', async () => {
    const local = await fixture(200)
    try {
      await local.connect()
      expect(local.client.getServerCapabilities()).toEqual({ tools: {} })
      expect(local.requests.map(request => request.method)).toEqual(['server/discover'])
      expect(local.transports).toHaveLength(1)
    }
    finally {
      await local.close()
    }
  })

  it('propagates a failed initialize without looping through fallback connections', async () => {
    const local = await fixture(500, 500)
    try {
      await expect(local.connect()).rejects.toMatchObject({ status: 500 })
      expect(local.requests.map(request => request.method)).toEqual(['server/discover', 'initialize'])
      expect(local.transports).toHaveLength(2)
    }
    finally {
      await local.close()
    }
  })

  it('does not start a fallback connection after disposal', async () => {
    const local = await fixture()
    try {
      await expect(local.connect(true)).rejects.toMatchObject({ status: 500 })
      expect(local.requests.map(request => request.method)).toEqual(['server/discover'])
      expect(local.transports).toHaveLength(1)
    }
    finally {
      await local.close()
    }
  })
})
