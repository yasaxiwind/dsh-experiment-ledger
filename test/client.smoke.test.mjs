/**
 * Client smoke test: load the browser bundle with a stubbed React and slots,
 * then render the dialog in empty and populated states. This catches syntax,
 * registration and render-path errors without a browser.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

/** Minimal React element stub. */
function createElement(type, props, ...children) {
  return { type, props: props ?? {}, children: children.flat() }
}

const ReactStub = {
  createElement,
  Fragment: Symbol.for('react.fragment'),
  useRef: (value) => ({ current: value }),
  useEffect: () => undefined,
  useState: (value) => [value, () => {}],
}

/** Collect the factory registered by the bundle. */
let factory
globalThis.window = {
  __ModuleLoader__: {
    load: ({ id, factory: registered }) => {
      assert.equal(id, 'dsh-experiment-ledger')
      factory = registered
    },
  },
}

await import('../client.js')

/**
 * @param t - element tree.
 * @param found - collected strings.
 * @returns the collected strings.
 */
function collectText(t, found = []) {
  if (t === null || t === undefined) return found
  if (typeof t === 'string' || typeof t === 'number') {
    found.push(String(t))
    return found
  }
  if (Array.isArray(t)) {
    for (const child of t) collectText(child, found)
    return found
  }
  // Function components are rendered by React; the stub renders them itself so
  // their text is reachable without a DOM.
  if (typeof t.type === 'function') {
    const props = { ...t.props, children: t.children.length === 1 ? t.children[0] : t.children }
    return collectText(t.type(props), found)
  }
  if (t.children !== undefined) collectText(t.children, found)
  return found
}

/**
 * Build the fake client context and return what `apply` registered.
 * @returns {{ entries: object[], render: object }} registrations and module.
 */
function boot() {
  const module = factory((name) => {
    assert.equal(name, 'react')
    return ReactStub
  })
  const dictionaries = new Map()
  const entries = []
  const ctx = {
    effect: (fn) => fn(),
    locale: {
      register: (ns, dicts) => dictionaries.set(ns, dicts),
      bind: (ns) => (key, params) => {
        const dict = dictionaries.get(ns)
        const text = dict?.zh?.[key] ?? key
        return params === undefined ? text : text.replace(/\{(\w+)\}/g, (m, k) => params[k] ?? m)
      },
    },
    slots: {
      inject: (_name, callback) => callback(),
      register: (definition, component) => entries.push({ definition, component }),
    },
  }
  module.apply(ctx)
  return { entries, module }
}

test('client registers a footer action and an overlay', () => {
  const { entries } = boot()
  assert.equal(entries.length, 2)
  assert.equal(entries[0].definition.name, 'sidebar.footer.action')
  assert.equal(entries[1].definition.name, 'shell.overlay')
})

test('footer action renders its label', () => {
  const { entries } = boot()
  const action = entries[0]
  const tree = action.component({ wide: true, open: () => {}, t: (key) => key })
  assert.ok(collectText(tree).includes('open'))
})

test('dialog renders empty and populated states without throwing', () => {
  const { entries } = boot()
  const dialog = entries[1]
  const actions = {
    close: () => {},
    refresh: () => {},
    chooseRoot: () => {},
    chooseExperiment: () => {},
    chooseRun: () => {},
    backToRuns: () => {},
    openCandidates: () => {},
    closeCandidates: () => {},
    promote: () => {},
    generateReport: () => {},
    toggleSweep: () => {},
    startSweep: () => {},
    refreshSweep: () => {},
    stopSweep: () => {},
    openReport: () => {},
    addBaseline: () => {},
    removeBaseline: () => {},
    toggleCompare: () => {},
    openCompare: () => {},
    closeCompare: () => {},
    loadMultiCompare: () => {},
    setMultiCompareGroup: () => {},
    setMultiCompareMetric: () => {},
    exportCompare: () => {},
    openCompareExport: () => {},
    addCompareExtra: () => {},
    removeCompareExtra: () => {},
    reportCompare: () => {},
    openCompareReport: () => {},
    savePreset: () => {},
    deletePreset: () => {},
    saveSchedule: () => {},
    deleteSchedule: () => {},
    toggleSchedule: () => {},
    runSchedule: () => {},
    loadNotifications: () => {},
    markNotificationsRead: () => {},
    markNotificationRead: () => {},
    openNotification: () => {},
    loadAllNotifications: () => {},
    openNotificationCenter: () => {},
    closeNotificationCenter: () => {},
    markCenterNotificationRead: () => {},
    openAllNotification: () => {},
    resumeSchedule: () => {},
    openScheduleDetail: () => {},
    closeScheduleDetail: () => {},
    markNotificationsReadBulk: () => {},
    resumeSchedules: () => {},
    reportSchedule: () => {},
    openScheduleReport: () => {},
    openSearch: () => {},
    closeSearch: () => {},
    setSearchQuery: () => {},
    setSearchStatus: () => {},
    runSearch: () => {},
    openSearchResult: () => {},
    reproduceRun: () => {},
    updateExperiment: () => {},
    updateRun: () => {},
    deleteRun: () => {},
    toggleShowArchived: () => {},
    exportLedger: () => {},
    exportLedgerZip: () => {},
    importLedger: () => {},
    cloneExperiment: () => {},
    concludeExperiment: () => {},
    openReviews: () => {},
    closeReviews: () => {},
    reviewExperiments: () => {},
    approveAllReviews: () => {},
  }
  const t = (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`)

  const empty = dialog.component({
    ...actions,
    t,
    useDialog: () => ({
      open: true, loading: false, roots: [], root: null, experiments: [],
      selectedId: null, detail: null, detailLoading: false, runId: null, error: null,
    }),
  })
  assert.ok(collectText(empty).includes('noRoots'))

  const experiment = {
    id: 'exp-1',
    name: 'PID',
    description: 'tune',
    tags: ['pid', 'demo'],
    factors: [{ key: 'kp', label: 'Kp' }],
    metrics: [{ key: 'overshoot', label: 'Overshoot', unit: '%', direction: 'min' }],
    runs: [
      {
        id: 'run-1', label: 'a', status: 'ok', durationMs: 1200,
        params: { kp: 1 }, metrics: { overshoot: 4.2 }, artifacts: [], startedAt: 1,
        manifest: {
          command: 'node job.mjs',
          cwd: 'C:\\p',
          git: { commit: 'a'.repeat(40), branch: 'main', dirty: true },
          toolchain: { node: 'v24.0.0', platform: 'win32', arch: 'x64' },
          env: { EXP_SEED: '7' },
        },
      },
      {
        id: 'run-2', label: 'b', status: 'failed', durationMs: 500,
        params: {}, metrics: {}, artifacts: [{ path: 'x', missing: true }], startedAt: 2,
        stdoutTail: 'out', stderrTail: 'err', notes: 'n',
        manifest: {
          command: 'node job.mjs',
          cwd: 'C:\\p',
          git: { commit: 'b'.repeat(40), branch: 'main', dirty: false },
          toolchain: { node: 'v24.0.0', platform: 'win32', arch: 'x64' },
          env: {},
        },
        datasets: [{ path: 'C:\\p\\data.csv', kind: 'csv', rows: 2, cols: 2, sha256: 'b'.repeat(64) }],
      },
    ],
  }
  const filled = dialog.component({
    ...actions,
    t,
    useDialog: () => ({
      open: true, loading: false,
      roots: [{ path: 'C:\\p\\.experiments', lastUsedAt: 1 }],
      root: 'C:\\p\\.experiments',
      experiments: [{ id: 'exp-1', name: 'PID', runs: 2, lastStatus: 'failed', updatedAt: 2, factors: 1, metrics: 1 }],
      selectedId: 'exp-1', detail: experiment, detailLoading: false, runId: null, error: null,
    }),
  })
  const text = collectText(filled).join('\n')
  assert.match(text, /PID/)
  assert.match(text, /compare/)
  assert.match(text, /groupAuto|kp=1/)
  assert.match(text, /baselineNone|addBaseline/)
  assert.match(text, /tags/)
  assert.match(text, /htmlReport/)
  assert.match(text, /exportLedger/)
  assert.match(text, /importLedger/)
  assert.match(text, /clone/)
  assert.match(text, /conclusion/)
  assert.match(text, /reviewQueue/)

  const withBaseline = {
    ...experiment,
    baselines: [{
      id: 'base-1', name: 'reference',
      experimentId: 'exp-2', experimentName: 'Base', runId: 'run-b', label: 'b',
      metrics: { overshoot: 3 }, params: {},
    }],
  }
  const baselineDialog = dialog.component({
    ...actions,
    t,
    useDialog: () => ({
      open: true, loading: false,
      roots: [{ path: 'C:\\p\\.experiments', lastUsedAt: 1 }],
      root: 'C:\\p\\.experiments',
      experiments: [{ id: 'exp-1', name: 'PID', runs: 2, lastStatus: 'ok', updatedAt: 2, factors: 1, metrics: 1 }],
      selectedId: 'exp-1', detail: withBaseline, detailLoading: false, runId: 'run-2', error: null,
      baselineOptions: {
        experiments: [{ id: 'exp-2', name: 'Base', runs: [{ id: 'run-b', label: 'b', metrics: { overshoot: 3 }, params: {} }] }],
      },
    }),
  })
  const baselineText = collectText(baselineDialog).join('\n')
  assert.match(baselineText, /vsBaseline/)
  assert.match(baselineText, /Base/)

  const multi = dialog.component({
    ...actions,
    t,
    useDialog: () => ({
      open: true, loading: false,
      roots: [{ path: 'C:\\p\\.experiments', lastUsedAt: 1 }],
      root: 'C:\\p\\.experiments',
      experiments: [
        { id: 'exp-1', name: 'PID', runs: 2, lastStatus: 'ok', updatedAt: 2, factors: 1, metrics: 1 },
        { id: 'exp-2', name: 'Base', runs: 1, lastStatus: 'ok', updatedAt: 1, factors: 1, metrics: 1 },
      ],
      selectedId: 'exp-1', detail: experiment, detailLoading: false, runId: null, error: null,
      compareIds: ['exp-1', 'exp-2'], compareOpen: true, multiCompareLoading: false,
      multiCompare: {
        groupBy: [],
        commonFactors: ['kp'],
        metrics: [{ key: 'overshoot', label: 'Overshoot', unit: '%' }],
        labels: ['all runs'],
        experiments: [
          { id: 'exp-1', name: 'PID', runCount: 2, groups: [{ label: 'all runs', runs: 2, stats: { overshoot: { n: 2, mean: 8.3, sd: 4.1, min: 4.2, max: 12.4 } } }] },
          { id: 'exp-2', name: 'Base', runCount: 1, groups: [{ label: 'all runs', runs: 1, stats: { overshoot: { n: 1, mean: 3, sd: 0, min: 3, max: 3 } } }] },
        ],
      },
      multiMetric: 'overshoot',
      multiGroup: '',
    }),
  })
  const multiText = collectText(multi).join('\n')
  assert.match(multiText, /multiCompareTitle/)
  assert.match(multiText, /PID/)
  assert.match(multiText, /8\.3/)
  assert.match(multiText, /exportCsv/)
  assert.match(multiText, /compareReport/)

  const withRun = dialog.component({
    ...actions,
    t,
    useDialog: () => ({
      open: true, loading: false,
      roots: [{ path: 'C:\\p\\.experiments', lastUsedAt: 1 }],
      root: 'C:\\p\\.experiments',
      experiments: [{ id: 'exp-1', name: 'PID', runs: 2, lastStatus: 'failed', updatedAt: 2, factors: 1, metrics: 1 }],
      selectedId: 'exp-1', detail: experiment, detailLoading: false, runId: 'run-2', error: null,
    }),
  })
  const runText = collectText(withRun).join('\n')
  assert.match(runText, /datasets/)
  assert.match(runText, /diffVsPrevious/)
  assert.match(runText, /noChanges|kp|overshoot/)
  assert.match(runText, /generateReport/)
  assert.match(runText, /toolchain/)
  assert.match(runText, /reproduce/)
  assert.match(runText, /notes/)
  assert.match(runText, /deleteRun/)

  const candidates = dialog.component({
    ...actions,
    t,
    useDialog: () => ({
      open: true, loading: false,
      roots: [{ path: 'C:\\p\\.experiments', lastUsedAt: 1 }],
      root: 'C:\\p\\.experiments',
      experiments: [{ id: 'exp-1', name: 'PID', runs: 2, lastStatus: 'failed', updatedAt: 2, factors: 1, metrics: 1 }],
      selectedId: 'exp-1', detail: experiment, detailLoading: false, runId: null, error: null,
      candidatesOpen: true, candidateLoading: false, busy: null,
      candidates: [{ id: 'cand-1', tool: 'pwsh', command: 'node train.js --epochs 3', status: 'ok', durationMs: 1200, at: 1 }],
    }),
  })
  const candidateText = collectText(candidates).join('\n')
  assert.match(candidateText, /candidates/)
  assert.match(candidateText, /promote/)
  assert.match(candidateText, /node train\.js/)

  const sweep = dialog.component({
    ...actions,
    t,
    useDialog: () => ({
      open: true, loading: false,
      roots: [{ path: 'C:\\p\\.experiments', lastUsedAt: 1 }],
      root: 'C:\\p\\.experiments',
      experiments: [{ id: 'exp-1', name: 'PID', runs: 2, lastStatus: 'ok', updatedAt: 2, factors: 1, metrics: 1 }],
      selectedId: 'exp-1',
      detail: {
        ...experiment,
        sweepPresets: [{ id: 'preset-1', name: 'quick', command: 'node job.mjs', grid: { k: [1] }, maxParallel: 1, failFast: false }],
        schedules: [{
          id: 'sched-1', name: 'nightly', preset: 'quick', intervalMs: 3600000, enabled: true, lastStatus: 'done',
          retryLimit: 2, retryCount: 1, failureLimit: 2, failureCount: 1,
          history: [{ jobId: 'sweep-1', startedAt: 1, endedAt: 1201, durationMs: 1200, status: 'done', done: 2, total: 2, failed: 0, metrics: { m: 2 } }],
        }],
      },
      detailLoading: false, runId: null, error: null,
      sweepOpen: true, sweepJob: null,
      notifications: [{ id: 'note-1', level: 'error', text: 'Scheduled sweep "nightly" paused after 2 consecutive failures.', read: false, createdAt: 1, action: 'resume-run' }],
    }),
  })
  const sweepForm = collectText(sweep).join('\n')
  assert.match(sweepForm, /sweepTitle/)
  assert.match(sweepForm, /sweepStart/)
  assert.match(sweepForm, /presetSave/)
  assert.match(sweepForm, /scheduleSave/)
  assert.match(sweepForm, /nightly/)
  assert.match(sweepForm, /scheduleHistory/)
  assert.match(sweepForm, /retryStatus/)
  assert.match(sweepForm, /failureStatus/)
  assert.match(sweepForm, /viewNotification/)
  assert.match(sweepForm, /resumeRun/)
  assert.match(sweepForm, /markAllRead/)

  const center = dialog.component({
    ...actions,
    t,
    useDialog: () => ({
      open: true, loading: false,
      roots: [{ path: 'C:\\p\\.experiments', lastUsedAt: 1 }],
      root: 'C:\\p\\.experiments',
      experiments: [{ id: 'exp-1', name: 'PID', runs: 2, lastStatus: 'ok', updatedAt: 2, factors: 1, metrics: 1 }],
      selectedId: 'exp-1', detail: experiment, detailLoading: false, runId: null, error: null,
      notificationCenterOpen: true, allNotificationsLoading: false,
      bulkResult: { kind: 'resume', ok: 1, failed: 1, failedNotes: [{ id: 'note-2', root: 'C:\\p\\.experiments', action: 'resume-run' }] },
      allNotifications: [{
        id: 'note-1', root: 'C:\\p\\.experiments', level: 'error',
        text: 'Scheduled sweep "nightly" paused after 2 consecutive failures.',
        read: false, experimentId: 'exp-1', createdAt: 1, action: 'resume-run',
      }],
    }),
  })
  const centerText = collectText(center).join('\n')
  assert.match(centerText, /notificationCenter/)
  assert.match(centerText, /paused after 2 consecutive failures/)
  assert.match(centerText, /markRead/)
  assert.match(centerText, /resumeRun/)
  assert.match(centerText, /bulkRead/)
  assert.match(centerText, /filterAll/)
  assert.match(centerText, /bulkResult/)
  assert.match(centerText, /retryFailed/)

  const searchState = dialog.component({
    ...actions,
    t,
    useDialog: () => ({
      open: true, loading: false,
      roots: [{ path: 'C:\\p\\.experiments', lastUsedAt: 1 }],
      root: 'C:\\p\\.experiments',
      experiments: [{ id: 'exp-1', name: 'PID', runs: 2, lastStatus: 'ok', updatedAt: 2, factors: 1, metrics: 1 }],
      selectedId: 'exp-1', detail: experiment, detailLoading: false, runId: null, error: null,
      searchOpen: true, searchQuery: 'kp', searchStatus: '', searchLoading: false,
      searchResults: [{
        experimentId: 'exp-1', experimentName: 'PID',
        run: { id: 'run-1', status: 'ok', params: { kp: 1 }, metrics: { overshoot: 4.2 }, startedAt: 1 },
      }],
    }),
  })
  const searchText = collectText(searchState).join('\n')
  assert.match(searchText, /search/)
  assert.match(searchText, /run-1/)
  assert.match(searchText, /PID/)

  const scheduleDetail = dialog.component({
    ...actions,
    t,
    useDialog: () => ({
      open: true, loading: false,
      roots: [{ path: 'C:\\p\\.experiments', lastUsedAt: 1 }],
      root: 'C:\\p\\.experiments',
      experiments: [{ id: 'exp-1', name: 'PID', runs: 2, lastStatus: 'ok', updatedAt: 2, factors: 1, metrics: 1 }],
      selectedId: 'exp-1',
      detail: {
        ...experiment,
        schedules: [{
          id: 'sched-1', name: 'nightly', preset: 'quick', intervalMs: 3600000, enabled: true, lastStatus: 'done',
          history: [{ jobId: 'j1', startedAt: 1, endedAt: 1201, durationMs: 1200, status: 'done', done: 2, total: 2, failed: 0, metrics: { m: 2 } }],
        }],
      },
      detailLoading: false, runId: null, error: null, scheduleDetailId: 'sched-1',
      scheduleReport: { path: 'C:\\p\\.experiments\\reports\\schedule.md', relative: 'reports\\schedule.md' },
      scheduleReports: [{ id: 'srep-1', scheduleId: 'sched-1', path: 'reports\\schedule-old.md' }],
    }),
  })
  const scheduleDetailText = collectText(scheduleDetail).join('\n')
  assert.match(scheduleDetailText, /scheduleDetail/)
  assert.match(scheduleDetailText, /scheduleHistoryTitle/)
  assert.match(scheduleDetailText, /done/)
  assert.match(scheduleDetailText, /ms/)
  assert.match(scheduleDetailText, /scheduleReportPath/)
  assert.match(scheduleDetailText, /openScheduleReport/)
  assert.match(scheduleDetailText, /scheduleReportHistory/)

  const sweepRunning = dialog.component({
    ...actions,
    t,
    useDialog: () => ({
      open: true, loading: false,
      roots: [{ path: 'C:\\p\\.experiments', lastUsedAt: 1 }],
      root: 'C:\\p\\.experiments',
      experiments: [{ id: 'exp-1', name: 'PID', runs: 2, lastStatus: 'ok', updatedAt: 2, factors: 1, metrics: 1 }],
      selectedId: 'exp-1', detail: experiment, detailLoading: false, runId: null, error: null,
      sweepOpen: true,
      sweepJob: {
        id: 'sweep-1', status: 'running', total: 2, done: 1, errors: [],
        runs: [{ id: 'run-1', params: { kp: 1 }, status: 'ok', durationMs: 100, metrics: { m: 2 } }],
      },
    }),
  })
  const sweepText = collectText(sweepRunning).join('\n')
  assert.match(sweepText, /sweepRunning/)
  assert.match(sweepText, /kp=1/)
})
