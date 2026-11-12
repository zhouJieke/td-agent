import type { ReactElement } from 'react'
import type { EmployeeMcpPage } from '../apis/employee-mcps'
import type { PostApiTauriExtensionMcpBody as McpSaveBody } from '../apis/index.type'
import type { McpRow } from '../types'
import type { McpEditorMode, McpEditorState, McpTabProps } from './mcp-tab.types'
import { Action, ArrowRotateRight, Button, Card, Gear, Icon, Input, Magnifier, Modal, PlugConnection, Plus, SegmentedControl, Select, Switch, Tag, TerminalLine, Text, Toast, TrashBin, TriangleExclamation as Warning } from 'dsh-tauri-ui/client'
import { compact, If, invoke, useWatchImmediate } from 'dsh-tauri/client'
import { useEffect, useId, useRef, useState } from 'react'
import { deleteMcp, getMcp, getMcpAuthorize, postMcp, postMcpAuthorize, postMcpCheck, postMcpToggle } from '../apis'
import { getEmployeeMcps } from '../apis/employee-mcps'
import { EMPLOYEE_MCP_ID_PREFIX, MCP_RESTART_INITIAL_DELAY_MS, MCP_RESTART_POLL_INTERVAL_MS, MCP_RESTART_TIMEOUT_MS } from '../constants'
import { useTimers } from '../hooks/use-timers'
import { installEmployeeMcp } from '../service/employee-mcps'
import { restartHost } from '../service/restart'
import { isDesktopHost } from '../service/restart.utils'
import { McpEditorForm } from './mcp-editor-form'
import { mapToPairs, parseMcpJson, parsePairs } from './mcp-tab.utils'
import { failText } from './outcome.utils'

function rowScope(row: McpRow): 'global' | 'profile' {
  return row.scope ?? row.layer ?? 'profile'
}

function rowKey(row: McpRow): string {
  return `${rowScope(row)}:${row.id}`
}

export function McpTab({ t }: McpTabProps): ReactElement {
  const tabsId = useId()
  const [servers, setServers] = useState<McpRow[] | null>(null)
  const [tab, setTab] = useState('installed')
  const [search, setSearch] = useState('')
  const [enterpriseQuery, setEnterpriseQuery] = useState({ pageNo: 1, keyword: '' })
  const [enterpriseReload, setEnterpriseReload] = useState(0)
  const [enterprisePage, setEnterprisePage] = useState<EmployeeMcpPage | null>(null)
  const [enterpriseLoading, setEnterpriseLoading] = useState(false)
  const [enterpriseError, setEnterpriseError] = useState('')
  const enterpriseRequestRef = useRef(0)
  const [loadError, setLoadError] = useState('')
  const [editor, setEditor] = useState<McpEditorState | null>(null)
  const [confirmRow, setConfirmRow] = useState<McpRow | null>(null)
  const [revealedCredentials, setRevealedCredentials] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [restartConfirm, setRestartConfirm] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [toast, setToast] = useState<{ text: string, ok: boolean, seq: number } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [editorMode, setEditorMode] = useState<McpEditorMode>('json')
  const [pasteJson, setPasteJson] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [scope, setScope] = useState<'all' | 'global' | 'profile'>('all')
  const [checking, setChecking] = useState<string | null>(null)
  const [globalError, setGlobalError] = useState('')
  const [requiresAuth, setRequiresAuth] = useState<Record<string, boolean>>({})
  const [authorizing, setAuthorizing] = useState<string | null>(null)
  const { mounted, later } = useTimers()

  useWatchImmediate([tab, enterpriseQuery.pageNo, enterpriseQuery.keyword, enterpriseReload], () => {
    const request = ++enterpriseRequestRef.current
    if (tab !== 'enterprise')
      return
    setEnterpriseLoading(true)
    setEnterpriseError('')
    setEnterprisePage(null)
    void getEmployeeMcps({ ...enterpriseQuery, pageSize: 20 }).then(
      (page) => {
        if (mounted.current && request === enterpriseRequestRef.current) {
          setEnterprisePage(page)
          setEnterpriseLoading(false)
        }
      },
      (error: unknown) => {
        if (mounted.current && request === enterpriseRequestRef.current) {
          setEnterpriseError(error instanceof Error ? error.message : String(error))
          setEnterpriseLoading(false)
        }
      },
    )
  })

  useEffect(() => {
    let current = true
    void getMcp().then(
      (body) => {
        if (current) {
          if ('error' in body) {
            setServers([])
            setLoadError(failText(t, new Error(body.error)))
            return
          }
          setLoadError('')
          setServers(body.servers)
          setRevealedCredentials([])
          setGlobalError(body.globalError ?? '')
          setRequiresAuth({})
          for (const row of body.servers.filter(row => row.transport !== 'stdio' && !row.disabled && !row.shadowed)) {
            void postMcpCheck({ id: row.id, scope: rowScope(row) }).then(
              (result) => {
                if (current)
                  setRequiresAuth(previous => ({ ...previous, [rowKey(row)]: !('error' in result) && result.requiresAuth === true }))
              },
              () => {
                if (current)
                  setRequiresAuth(previous => ({ ...previous, [rowKey(row)]: false }))
              },
            )
          }
        }
      },
      (error: Error) => {
        if (current) {
          setServers([])
          setLoadError(failText(t, error))
        }
      },
    )
    return () => {
      current = false
    }
  }, [reload, t])

  const checkConnectivity = async (row: McpRow): Promise<void> => {
    setChecking(rowKey(row))
    try {
      const result = await postMcpCheck({ id: row.id, scope: rowScope(row) })
      if ('error' in result)
        throw new Error(result.error)
      setRequiresAuth(previous => ({ ...previous, [rowKey(row)]: result.requiresAuth === true }))
      setToast({
        text: result.ok ? `${t('connectivityOk')}${result.detail ? ` (${result.detail})` : ''}` : `${t('connectivityFailed')}: ${result.detail ?? ''}`,
        ok: result.ok,
        seq: Date.now(),
      })
    }
    catch (error) {
      setToast({ text: `${t('connectivityFailed')}: ${String(error)}`, ok: false, seq: Date.now() })
    }
    finally { setChecking(null) }
  }

  const authorize = async (row: McpRow): Promise<void> => {
    setAuthorizing(rowKey(row))
    const desktop = 'dshDesktop' in window
    const browser = desktop ? null : window.open('about:blank', '_blank')
    if (browser !== null)
      browser.opener = null
    try {
      if (!desktop && browser === null)
        throw new Error(t('authorizationBrowserBlocked'))
      const result = await postMcpAuthorize({ id: row.id, scope: rowScope(row) })
      if (!mounted.current) {
        browser?.close()
        return
      }
      if ('error' in result)
        throw new Error(result.error)
      const url = new URL(result.authorizationUrl)
      if (url.protocol !== 'https:' || url.username !== '' || url.password !== '')
        throw new Error(t('authorizationUrlInvalid'))
      if (desktop)
        await invoke('open_external_url', { url: url.href })
      else if (browser !== null)
        browser.location.href = url.href
      const deadline = Date.now() + 300_000
      const poll = async (): Promise<void> => {
        if (!mounted.current)
          return
        try {
          if (Date.now() >= deadline)
            throw new Error(t('authorizationTimeout'))
          const status = await getMcpAuthorize({ query: { attemptId: result.attemptId } })
          if (!mounted.current)
            return
          if (!('status' in status))
            throw new Error(status.error)
          if (status.status === 'error')
            throw new Error(status.error ?? t('authorizationFailed'))
          if (status.status === 'authorized') {
            setRequiresAuth(previous => ({ ...previous, [rowKey(row)]: false }))
            setAuthorizing(null)
            setToast({ text: t('authorizationRestartNeeded'), ok: true, seq: Date.now() })
            return
          }
          later(() => void poll(), 1_500)
        }
        catch (error) {
          if (!mounted.current)
            return
          setAuthorizing(null)
          setToast({ text: failText(t, error), ok: false, seq: Date.now() })
        }
      }
      if (mounted.current)
        later(() => void poll(), 1_500)
    }
    catch (error) {
      browser?.close()
      if (mounted.current) {
        setAuthorizing(null)
        setToast({ text: failText(t, error), ok: false, seq: Date.now() })
      }
    }
  }

  const openCreate = (): void => {
    setFormError(null)
    setPasteError(null)
    setPasteJson('')
    setEditorMode('json')
    setEditor({ id: '', scope: 'profile', serverName: '', transport: 'stdio', command: '', args: '', env: '', url: '', headers: '' })
  }

  const openEdit = (row: McpRow): void => {
    setFormError(null)
    setPasteError(null)
    setPasteJson('')
    setEditorMode('form')
    setEditor({
      id: row.id,
      scope: rowScope(row),
      serverName: row.serverName,
      transport: row.transport,
      command: row.command ?? '',
      args: (row.args ?? []).join('\n'),
      env: mapToPairs(row.env, '='),
      url: row.url ?? '',
      headers: mapToPairs(row.headers, ':'),
    })
  }

  const doPasteFill = (): void => {
    if (editor === null || pasteJson.trim() === '')
      return
    const parsed = parseMcpJson(pasteJson)
    if ('error' in parsed) {
      setPasteError(parsed.error)
      return
    }
    const lockIdentity = editor.id !== ''
    if (lockIdentity && parsed.transport !== editor.transport) {
      setPasteError(t('pasteTransportMismatch'))
      return
    }
    setPasteError(null)
    setFormError(null)
    setEditor({
      ...editor,
      ...(parsed.serverName !== undefined && !lockIdentity ? { serverName: parsed.serverName } : {}),
      ...(!lockIdentity ? { transport: parsed.transport } : {}),
      ...(parsed.transport === 'stdio'
        ? {
            command: parsed.command ?? editor.command,
            args: (parsed.args ?? []).join('\n'),
            env: mapToPairs(parsed.env, '='),
          }
        : {
            url: parsed.url ?? editor.url,
            headers: mapToPairs(parsed.headers, ':'),
          }),
    })
    setEditorMode('form')
  }

  const doSave = async (): Promise<void> => {
    if (editor === null)
      return
    let input: McpSaveBody
    if (editorMode === 'json') {
      const parsed = parseMcpJson(pasteJson)
      if ('error' in parsed) {
        setPasteError(parsed.error)
        return
      }
      input = {
        id: editor.id,
        scope: editor.scope,
        serverName: parsed.serverName?.trim() ?? '',
        transport: parsed.transport,
        ...(parsed.transport === 'stdio'
          ? { command: parsed.command ?? '', args: parsed.args ?? [], env: parsed.env ?? {} }
          : { url: parsed.url ?? '', headers: parsed.headers ?? {} }),
      }
    }
    else {
      input = {
        id: editor.id,
        scope: editor.scope,
        serverName: editor.serverName.trim(),
        transport: editor.transport,
        ...(editor.transport === 'stdio'
          ? {
              command: editor.command.trim(),
              args: compact(editor.args.split(/\r?\n/).map(line => line.trim())),
              env: parsePairs(editor.env, '='),
            }
          : {
              url: editor.url.trim(),
              headers: parsePairs(editor.headers, ':'),
            }),
      }
    }
    setBusy(true)
    setFormError(null)
    setPasteError(null)
    try {
      const body = await postMcp(input)
      if ('error' in body)
        throw new Error(body.error)
      setTab('installed')
      if (editor.id === '') {
        setSearch('')
        setScope('all')
      }
      setEditor(null)
      setToast({ text: t(body.restartNeeded ? 'restartNeeded' : 'mcpApplied'), ok: true, seq: Date.now() })
      setReload(value => value + 1)
    }
    catch (error) {
      setFormError(String(error instanceof Error ? error.message : error))
    }
    finally {
      setBusy(false)
    }
  }

  const doInstall = async (mcpCode: string): Promise<void> => {
    if (busy)
      return
    setBusy(true)
    setInstalling(mcpCode)
    try {
      const result = await installEmployeeMcp({ mcpCode })
      if (!mounted.current)
        return
      if (!result.ok)
        throw new Error(result.error === 'EMPLOYEE_MCP_INVALID_RESPONSE' ? t('enterpriseMcpInvalidResponse') : result.error === 'EMPLOYEE_MCP_ALREADY_INSTALLED' ? t('mcpAlreadyInstalled') : result.error)
      setTab('installed')
      setSearch('')
      setScope('all')
      setToast({ text: t(result.restartNeeded ? 'restartNeeded' : 'mcpInstalled'), ok: true, seq: Date.now() })
      setReload(value => value + 1)
    }
    catch (error) {
      if (mounted.current)
        setToast({ text: failText(t, error), ok: false, seq: Date.now() })
    }
    finally {
      if (mounted.current) {
        setBusy(false)
        setInstalling(null)
      }
    }
  }

  const doToggle = async (row: McpRow): Promise<void> => {
    setBusy(true)
    try {
      const body = await postMcpToggle({ id: row.id, disabled: !row.disabled, scope: rowScope(row) })
      if ('error' in body)
        throw new Error(body.error)
      setServers(current => current?.map(server => rowKey(server) === rowKey(row) ? { ...server, disabled: !row.disabled } : server) ?? null)
      setToast({ text: t(body.restartNeeded ? 'restartNeeded' : 'mcpApplied'), ok: true, seq: Date.now() })
      setReload(value => value + 1)
    }
    catch (error) {
      setToast({ text: failText(t, error), ok: false, seq: Date.now() })
    }
    finally {
      setBusy(false)
    }
  }

  const doRemove = async (): Promise<void> => {
    if (confirmRow === null)
      return
    setBusy(true)
    try {
      const body = await deleteMcp({ id: confirmRow.id, scope: rowScope(confirmRow) })
      if ('error' in body)
        throw new Error(body.error)
      setServers(current => current?.filter(server => rowKey(server) !== rowKey(confirmRow)) ?? null)
      setConfirmRow(null)
      setToast({ text: t(body.restartNeeded ? 'restartNeeded' : 'mcpUninstalled'), ok: true, seq: Date.now() })
      setReload(value => value + 1)
    }
    catch (error) {
      setToast({ text: failText(t, error), ok: false, seq: Date.now() })
    }
    finally {
      setBusy(false)
    }
  }

  const doRestart = (): void => {
    setRestartConfirm(false)
    setRestarting(true)
    setToast({ text: t('restarting'), ok: true, seq: Date.now() })
    void restartHost()
    if (isDesktopHost())
      return
    const deadline = Date.now() + MCP_RESTART_TIMEOUT_MS
    const poll = (): void => {
      if (Date.now() > deadline)
        return
      later(() => {
        void getMcp().then(
          () => { window.location.reload() },
          () => { poll() },
        )
      }, MCP_RESTART_POLL_INTERVAL_MS)
    }
    later(poll, MCP_RESTART_INITIAL_DELAY_MS)
  }

  const scopeOptions = [
    { value: 'all', label: t('scopeAll') },
    { value: 'global', label: t('global') },
    { value: 'profile', label: t('profile') },
  ]
  const query = search.trim().toLocaleLowerCase()
  const cards = (servers ?? []).map((row) => {
    const url = row.transport !== 'stdio' && row.url && URL.canParse(row.url) ? new URL(row.url) : null
    const credentials = [
      ...Object.entries(row.transport === 'stdio' ? row.env ?? {} : row.headers ?? {}).map(([name, value]) => ({ source: t(row.transport === 'stdio' ? 'credentialEnv' : 'credentialHeaders'), name, value })),
      ...(url ? [...new Set(url.searchParams.keys())].map(name => ({ source: 'URL', name, value: url.searchParams.getAll(name).join('\n') })) : []),
    ].filter(({ value }) => value !== '')
    if (url) {
      for (const name of new Set(url.searchParams.keys()))
        url.searchParams.set(name, '********')
    }
    const description = row.transport === 'stdio' ? `${row.command ?? ''} ${(row.args ?? []).join(' ')}`.trim() : url?.href ?? row.url ?? ''
    const key = rowKey(row)
    return {
      row,
      key,
      scope: rowScope(row),
      description,
      credentials,
      searchText: `${row.serverName} ${row.id} ${description}`.toLocaleLowerCase(),
      waiting: checking === key || (!row.disabled && !row.shadowed && row.transport !== 'stdio' && requiresAuth[key] === undefined),
    }
  })
  const visibleCards = cards.filter(card => (scope === 'all' || card.scope === scope) && card.searchText.includes(query))
  const loaded = servers !== null && loadError === ''
  const installedIds = new Set((servers ?? []).map(row => row.id))

  return (
    <div className="box-border flex flex-col gap-[24px] font-sans text-primary text-[13px] leading-[1.5]">
      <header className="flex items-start justify-between gap-[20px] flex-wrap">
        <div className="flex min-w-0 flex-col gap-[8px]">
          <h1 className="m-0 text-[24px] leading-[32px] font-semibold tracking-[-0.5px]">{t('mcpManagement')}</h1>
          <p className="m-0 text-secondary text-[13px] leading-[20px]">{t('mcpManagementIntro')}</p>
        </div>
        <div className="flex items-center gap-[8px] flex-wrap">
          <Action
            variant="model"
            className="h-[36px] w-[36px] rounded-lg border border-solid border-border-l2"
            aria-label={t(tab === 'enterprise' ? 'refreshEnterpriseMcp' : 'refreshInstalledMcp')}
            title={t(tab === 'enterprise' ? 'refreshEnterpriseMcp' : 'refreshInstalledMcp')}
            disabled={busy || restarting || (tab === 'enterprise' && enterpriseLoading)}
            onClick={() => tab === 'enterprise' ? setEnterpriseReload(value => value + 1) : setReload(value => value + 1)}
          >
            <Icon as={ArrowRotateRight} size={16} />
          </Action>
          <Button variant="add" className="h-[36px] gap-[6px] rounded-lg bg-business px-[14px] hover:not-disabled:bg-business" disabled={busy || restarting} onClick={openCreate}>
            <Icon as={Plus} size={16} />
            {t('addServer')}
          </Button>
        </div>
      </header>

      <div className="flex items-center justify-between gap-[12px] flex-wrap border-0 border-b border-solid border-border-l2 pb-[16px]">
        <SegmentedControl
          id={tabsId}
          variant="segmented"
          label={t('mcpManagement')}
          value={tab}
          options={[
            { value: 'enterprise', label: t('enterpriseMcp') },
            { value: 'installed', label: `${t('installedMcp')} ${servers?.length ?? '—'}` },
          ]}
          onChange={setTab}
        />
        <div className="relative w-[280px] max-w-full">
          <span className="pointer-events-none absolute inset-y-0 left-[12px] flex items-center text-tertiary"><Icon as={Magnifier} size={16} /></span>
          <Input
            className="h-[36px] w-full box-border rounded-lg text-[13px] [&_input]:pl-[32px]"
            type="search"
            aria-label={t('searchMcp')}
            placeholder={t('searchMcp')}
            value={tab === 'enterprise' ? enterpriseQuery.keyword : search}
            onChange={event => tab === 'enterprise'
              ? setEnterpriseQuery({ pageNo: 1, keyword: event.target.value })
              : setSearch(event.target.value)}
          />
        </div>
      </div>

      <If cond={tab === 'enterprise'}>
        <section id={`${tabsId}-enterprise-panel`} role="tabpanel" aria-labelledby={`${tabsId}-enterprise`} aria-busy={enterpriseLoading} className="flex flex-col gap-[16px]">
          <If cond={enterpriseLoading}>
            <Text size="sm" tone="tertiary" role="status">{t('loading')}</Text>
          </If>
          <If cond={enterpriseError !== ''}>
            <Text tone="error" role="alert">{failText(t, new Error(enterpriseError === 'EMPLOYEE_MCP_INVALID_RESPONSE' ? t('enterpriseMcpInvalidResponse') : enterpriseError))}</Text>
          </If>
          <If cond={enterprisePage !== null}>
            <If cond={enterprisePage?.items.length === 0}>
              <div className="flex flex-col items-center gap-[12px] rounded-xl border border-dashed border-border-l3 bg-layer-1 px-[24px] py-[64px] text-center">
                <span className="inline-flex h-[56px] w-[56px] items-center justify-center rounded-xl bg-module-platform text-tertiary"><Icon as={PlugConnection} size={26} /></span>
                <Text>{t('enterpriseMcpEmpty')}</Text>
              </div>
            </If>
            <Card.List className="grid grid-cols-[repeat(2,minmax(0,1fr))] items-stretch gap-[16px] max-[680px]:grid-cols-[minmax(0,1fr)]">
              {enterprisePage?.items.map(item => (
                <Card key={item.id} className="mx-0 flex flex-col gap-[20px] rounded-xl border-border-l2 bg-layer-1 p-[20px] transition-colors hover:border-border-l3">
                  <div className="flex items-center gap-[12px] min-w-0">
                    <span aria-hidden="true" className="inline-flex h-[40px] w-[40px] flex-none items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--dsw-alias-state-business-primary)_8%,transparent)] text-business"><Icon as={item.transport === 'stdio' ? TerminalLine : PlugConnection} size={22} /></span>
                    <div className="flex min-w-0 flex-col gap-[4px]">
                      <Card.Title className="font-medium text-[15px]" title={item.name}>{item.name}</Card.Title>
                      <Card.Description className="text-[12px]" title={item.id}>{item.id}</Card.Description>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-[8px] border-0 border-t border-solid border-border-l2 pt-[12px]">
                    <Tag variant="version" tone="neutral">{item.transport}</Tag>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || restarting || !loaded || globalError !== '' || installedIds.has(`${EMPLOYEE_MCP_ID_PREFIX}${item.id}`)}
                      onClick={() => void doInstall(item.id)}
                    >
                      {t(installing === item.id ? 'mcpInstalling' : installedIds.has(`${EMPLOYEE_MCP_ID_PREFIX}${item.id}`) ? 'mcpAlreadyInstalled' : 'installMcp')}
                    </Button>
                  </div>
                </Card>
              ))}
            </Card.List>
            <div className="flex items-center justify-between gap-[8px] flex-wrap pt-[4px]">
              <Text tone="tertiary" size="sm">{t('enterpriseMcpTotal', { count: enterprisePage?.totalCount ?? 0 })}</Text>
              <div className="flex items-center gap-[8px]">
                <Button variant="outline" size="sm" disabled={enterpriseLoading || enterpriseQuery.pageNo <= 1} onClick={() => setEnterpriseQuery(previous => ({ ...previous, pageNo: previous.pageNo - 1 }))}>{t('previousPage')}</Button>
                <Text tone="secondary" size="sm">{`${enterprisePage?.pageNumber ?? enterpriseQuery.pageNo} / ${Math.max(1, enterprisePage?.pagesAvailable ?? 1)}`}</Text>
                <Button variant="outline" size="sm" disabled={enterpriseLoading || enterpriseQuery.pageNo >= (enterprisePage?.pagesAvailable ?? 0)} onClick={() => setEnterpriseQuery(previous => ({ ...previous, pageNo: previous.pageNo + 1 }))}>{t('nextPage')}</Button>
              </div>
            </div>
          </If>
        </section>
      </If>

      <section id={`${tabsId}-installed-panel`} role="tabpanel" aria-labelledby={`${tabsId}-installed`} hidden={tab !== 'installed'}>
        <div className="flex flex-col gap-[16px]">
          <div className="flex items-center justify-between gap-[8px] flex-wrap">
            <Select className="text-secondary text-[12px]" label={t('scope')} options={scopeOptions} value={scope} onChange={next => setScope(next as typeof scope)} />
            <div className="flex items-center gap-[6px] flex-wrap">
              <Button variant="ghost" size="sm" disabled={busy || restarting} onClick={() => setRestartConfirm(true)}>{t('restart')}</Button>
            </div>
          </div>
          <If cond={loadError !== ''}>
            <Text tone="error" role="alert">{loadError}</Text>
          </If>
          <If cond={globalError !== ''}>
            <Text tone="error" role="alert">{globalError}</Text>
          </If>
          <If cond={servers === null}>
            <Text size="sm" tone="tertiary">{t('loading')}</Text>
          </If>
          <If cond={loaded && visibleCards.length === 0}>
            <div className="flex flex-col items-center gap-[12px] rounded-xl border border-dashed border-border-l3 bg-layer-1 px-[24px] py-[64px] text-center">
              <span className="inline-flex h-[56px] w-[56px] items-center justify-center rounded-xl bg-module-platform text-tertiary"><Icon as={PlugConnection} size={26} /></span>
              <Text>{t(cards.length === 0 ? 'emptyMcp' : 'noMatchingMcp')}</Text>
              <Text tone="secondary">{t(cards.length === 0 ? 'emptyMcpHint' : 'noMatchingMcpHint')}</Text>
            </div>
          </If>
          <If cond={loaded && visibleCards.length > 0}>
            <Card.List className="grid grid-cols-[repeat(2,minmax(0,1fr))] items-stretch gap-[16px] max-[680px]:grid-cols-[minmax(0,1fr)]">
              {visibleCards.map(({ row, key, description, credentials, scope: cardScope, waiting }) => (
                <Card key={key} className="mx-0 flex flex-col gap-[16px] rounded-xl border-border-l2 bg-layer-1 p-[20px] transition-colors hover:border-border-l3">
                  <div className="flex items-center gap-[12px] min-w-0">
                    <span aria-hidden="true" className="inline-flex items-center justify-center flex-none w-[40px] h-[40px] rounded-xl bg-[color-mix(in_srgb,var(--dsw-alias-state-business-primary)_8%,transparent)] text-business"><Icon as={row.transport === 'stdio' ? TerminalLine : PlugConnection} size={22} /></span>
                    <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
                      <Card.Title className="font-medium text-[15px]" title={row.serverName}>{row.serverName}</Card.Title>
                      <Text tone="tertiary" size="sm">{t(cardScope === 'global' ? 'scopeGlobal' : 'scopeProfile')}</Text>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-[5px] text-[12px] text-secondary">
                      <Switch checked={!row.disabled} onChange={() => void doToggle(row)} label={`${t('toggleMcp')}: ${row.serverName}`} title={t('toggleMcpHint')} disabled={busy || restarting || row.shadowed === true} />
                      {t(row.disabled ? 'disabled' : 'enabled')}
                    </span>
                  </div>
                  <Card.Description className="rounded-lg bg-module-platform px-[10px] py-[8px] font-mono text-[11px] leading-[18px] text-secondary line-clamp-1 break-all" title={description}>{description}</Card.Description>
                  <div className="flex min-w-0 flex-col gap-[8px]">
                    <div className="flex items-center justify-between gap-[8px]">
                      <Text tone="secondary" size="sm">{t('mcpCredentials')}</Text>
                      <If cond={credentials.length > 0}>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`${t(revealedCredentials.includes(key) ? 'hideCredentials' : 'showCredentials')}: ${row.serverName}`}
                          aria-pressed={revealedCredentials.includes(key)}
                          onClick={() => setRevealedCredentials(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key])}
                        >
                          {t(revealedCredentials.includes(key) ? 'hideCredentials' : 'showCredentials')}
                        </Button>
                      </If>
                    </div>
                    {credentials.length === 0
                      ? <Text tone="tertiary" size="sm">{t('noCredentials')}</Text>
                      : (
                          <dl className="m-0 flex min-w-0 flex-col gap-[8px]">
                            {credentials.map(({ source, name, value }) => (
                              <div key={`${source}:${name}`} className="flex min-w-0 flex-col gap-[4px]">
                                <dt className="flex items-center gap-[6px] text-[12px] text-secondary">
                                  <span>{source}</span>
                                  <span className="font-mono break-all">{name}</span>
                                </dt>
                                <dd className="m-0 rounded-lg bg-module-platform px-[10px] py-[8px] font-mono text-[11px] leading-[18px] text-secondary break-all">{revealedCredentials.includes(key) ? value : '••••••••'}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                  </div>
                  <If cond={row.shadowed === true}>
                    <Text tone="error">{t('shadowedByGlobal')}</Text>
                  </If>
                  <div className="flex items-center justify-between gap-[8px] border-0 border-t border-solid border-border-l2 pt-[12px] mt-auto">
                    <Tag variant="version" tone="neutral">{row.transport}</Tag>
                    <div className="flex items-center gap-[4px]">
                      <Action variant="model" aria-label={t('edit')} title={t('edit')} disabled={busy} onClick={() => openEdit(row)}><Icon as={Gear} size={16} /></Action>
                      <Button variant="ghost" size="sm" className="hover:not-disabled:text-error" disabled={busy || restarting} onClick={() => setConfirmRow(row)}>
                        <Icon as={TrashBin} size={16} />
                        {t('uninstallMcp')}
                      </Button>
                      <Button
                        variant="outline"
                        className="ml-[4px] min-w-[60px] rounded-lg text-[12px]"
                        size="sm"
                        disabled={busy || restarting || row.disabled || row.shadowed === true || checking !== null || authorizing !== null || waiting}
                        onClick={() => void (requiresAuth[key] ? authorize(row) : checkConnectivity(row))}
                      >
                        {authorizing === key ? t('authorizationRunning') : waiting ? t('checkRunning') : t(requiresAuth[key] ? 'authorizeLabel' : 'checkLabel')}
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </Card.List>
          </If>
        </div>
      </section>

      <Modal
        open={editor !== null}
        onClose={() => setEditor(null)}
        closeLabel={t('close')}
        title={editor !== null && editor.id !== '' ? t('editServer') : t('addServer')}
        className="w-[min(760px,100%)]!"
        contentClassName="max-h-[calc(100vh-160px)]! overflow-y-auto"
      >
        {editor !== null && (
          <McpEditorForm
            t={t}
            editor={editor}
            mode={editorMode}
            busy={busy}
            pasteJson={pasteJson}
            pasteError={pasteError}
            formError={formError}
            onModeChange={setEditorMode}
            onEditorChange={patch => setEditor(current => current === null ? current : { ...current, ...patch })}
            onPasteJsonChange={setPasteJson}
            onPasteFill={doPasteFill}
            onCancel={() => setEditor(null)}
            onSave={() => void doSave()}
          />
        )}
      </Modal>

      <Modal
        open={confirmRow !== null}
        onClose={() => {
          if (!busy)
            setConfirmRow(null)
        }}
        closeLabel={t('close')}
        title={t('confirmRemove')}
        description={confirmRow?.id}
        footer={(
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmRow(null)}>{t('cancel')}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void doRemove()}>{t('uninstallMcp')}</Button>
          </>
        )}
      >
        <p>{t('removeWarn')}</p>
      </Modal>

      <Modal
        open={restartConfirm}
        onClose={() => setRestartConfirm(false)}
        closeLabel={t('close')}
        title={t('restartConfirmTitle')}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setRestartConfirm(false)}>{t('cancel')}</Button>
            <Button variant="primary" onClick={doRestart}>{t('restartNow')}</Button>
          </>
        )}
      >
        <p>{t('restartConfirmBody')}</p>
      </Modal>

      {toast !== null && <Toast key={toast.seq} text={toast.text} icon={toast.ok ? undefined : <Icon as={Warning} />} onDone={() => setToast(null)} />}
    </div>
  )
}
