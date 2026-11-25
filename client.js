/**
 * Browser half of the Experiment ledger bundle.
 *
 * Registers one sidebar footer action (beside Settings) and one `shell.overlay`
 * dialog. Both read one small store, so the button opens the dialog and the
 * dialog reloads from this package's Host routes. Runs come from the tools or
 * the recorder; the panel only promotes candidates and writes reports.
 *
 * @module dsh-experiment-ledger/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-experiment-ledger',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace of the panel's own text. */
    const NS = 'experimentLedger'
    /** Host route base. */
    const ENDPOINT = '/plugin-experiment-ledger'
    /** Package header the Host requires on both routes. */
    const REQUEST_HEADER = 'x-dsh-experiment-ledger'

    const zh = {
      open: '实验台账',
      title: '实验台账',
      close: '关闭',
      refresh: '刷新',
      root: '台账目录',
      noRoots: '还没有台账。在会话里让 agent 运行 exp_define，就会在这里出现。',
      noExperiments: '这个目录下还没有实验。用 exp_define 新建一个。',
      loading: '正在读取…',
      selectHint: '从左侧选择一个实验，查看它的运行记录。',
      runs: '运行',
      runsCount: '{count} 次运行',
      runsShort: 'n',
      compare: '对比',
      group: '分组',
      groupBy: '按因子分组',
      groupAuto: '自动（变化因子）',
      groupNone: '不分组',
      groupAll: '全部因子',
      chartMetric: '图表指标',
      chartLabel: '指标对比图',
      noRuns: '还没有运行记录。用 exp_run 或 exp_record 添加。',
      factors: '因子',
      metrics: '指标',
      label: '标签',
      status: '状态',
      duration: '耗时',
      params: '参数',
      metric: '指标',
      recordedAt: '记录于',
      artifacts: '产物',
      noArtifacts: '没有产物',
      datasets: '数据集',
      diffVsPrevious: '与上一次运行对比',
      noChanges: '没有变化',
      diffAdded: '新增',
      diffRemoved: '移除',
      diffChanged: '变更',
      stdout: '标准输出（末尾）',
      stderr: '标准错误（末尾）',
      notes: '备注',
      command: '命令',
      back: '返回',
      backToRuns: '返回运行表',
      runDetail: '运行详情',
      listFailed: '无法读取台账：{reason}',
      detailFailed: '无法读取实验：{reason}',
      networkFailed: '无法连接应用的本地服务，请重试。',
      statusOk: '成功',
      statusFailed: '失败',
      statusTimeout: '超时',
      statusError: '错误',
      statusRecorded: '已记录',
      hint: '台账写入 <项目>/.experiments；运行由 agent 工具记录。',
      loadingDetail: '正在读取实验…',
      candidates: '候选命令',
      candidatesHint: '被动记录的命令。选中实验后可一键提升为运行。',
      noCandidates: '还没有候选。用 bash/pwsh 跑条命令后会出现。',
      promote: '提升',
      promoting: '提升中…',
      promoted: '已提升为 {id}',
      promoteFailed: '提升失败：{reason}',
      promoteNeedsExperiment: '先在左侧选择一个实验。',
      candidatesFailed: '读取候选失败：{reason}',
      generateReport: '生成报告',
      generatingReport: '生成中…',
      reportReady: '报告已生成',
      reportFailed: '生成报告失败：{reason}',
      reportPath: '报告路径',
      copyPath: '复制路径',
      copied: '已复制',
      backToExperiments: '返回实验',
      targetExperiment: '提升到实验',
      sweep: '扫参',
      sweepTitle: '参数扫参',
      sweepCommand: '命令模板',
      sweepGrid: '参数网格（JSON）',
      sweepParallel: '并发',
      sweepFailFast: '失败即停',
      sweepStart: '开始扫参',
      sweepStop: '停止',
      sweepRunning: '运行中 {done}/{total}',
      sweepDone: '已完成 {done}/{total}',
      sweepStopped: '已停止 {done}/{total}',
      sweepFailed: '扫参失败：{reason}',
      sweepInvalidGrid: '网格必须是 JSON 对象，例如 {"kp": [0.8, 1.2]}',
      sweepCommandRequired: '命令模板不能为空',
      sweepNoRuns: '还没有结果。',
      promoteFormTitle: '提升候选',
      promoteLabel: '标签',
      promoteParams: '参数（JSON）',
      promoteMetrics: '指标（JSON）',
      promoteConfirm: '确认提升',
      promoteCancel: '取消',
      promoteInvalidJson: '{field} 不是合法 JSON',
      openReport: '打开',
      openingReport: '打开中…',
      openFailed: '打开失败：{reason}',
      openedReport: '已打开报告',
      baseline: '基线',
      baselineSet: '基线已设置',
      baselineFailed: '设置基线失败：{reason}',
      vsBaseline: '与基线对比',
      addBaseline: '添加基线',
      baselineRemove: '移除',
      compareExperiments: '对比实验',
      compareHint: '勾选 2–3 个实验，然后点“对比实验”。',
      compareNeedTwo: '至少选择 2 个实验。',
      compareMetric: '对比指标',
      compareGroup: '对比分组',
      compareFailed: '对比失败：{reason}',
      compareBack: '返回实验',
      multiCompareTitle: '多实验对比',
      exportCsv: '导出 CSV',
      exportMd: '导出 Markdown',
      exported: '已导出：{path}',
      exportFailed: '导出失败：{reason}',
      openExport: '打开导出',
      openedExport: '已打开导出',
      exportFile: '导出文件',
      preset: '预设',
      presetName: '预设名称',
      presetSave: '保存预设',
      presetSaved: '预设已保存',
      presetFailed: '保存预设失败：{reason}',
      presetDelete: '删除预设',
      addCrossExperiment: '添加其他项目实验',
      crossProject: '跨项目',
      compareReport: '生成对比报告',
      compareReportReady: '对比报告已生成',
      compareReportFailed: '对比报告失败：{reason}',
      openCompareReport: '打开对比报告',
      compareReportPath: '对比报告',
      schedule: '定时',
      scheduleName: '定时名称',
      schedulePreset: '预设',
      scheduleInterval: '间隔（分钟）',
      scheduleSave: '添加定时',
      scheduleDelete: '删除定时',
      scheduleRun: '立即运行',
      schedulePause: '暂停',
      scheduleResume: '启用',
      scheduleSaved: '定时已保存',
      scheduleFailed: '定时失败：{reason}',
      scheduleEnabled: '已启用',
      schedulePaused: '已暂停',
      compareReports: '历史对比报告',
      noCompareReports: '还没有对比报告。',
      compareReportsFailed: '读取对比报告失败：{reason}',
      notifications: '通知',
      unreadNotifications: '{count} 条未读通知',
      markAllRead: '全部已读',
      scheduleHistory: '历史 {ok}/{total}',
      scheduleAvg: '平均 {ms} ms',
      scheduleNoHistory: '还没有运行记录',
      viewNotification: '查看',
      retryLimit: '重试次数',
      retryDelay: '退避（秒）',
      retryStatus: '重试 {count}/{limit}',
      notificationCenter: '通知中心',
      noNotifications: '暂无通知',
      markRead: '标记已读',
      failureLimit: '连续失败暂停',
      failureStatus: '连续失败 {count}/{limit}',
      resumeRun: '恢复并运行',
      scheduleResumed: '已恢复并启动',
      scheduleDetail: '定时详情',
      scheduleHistoryTitle: '运行历史',
      filterAll: '全部',
      filterLevel: '级别',
      filterUnread: '仅未读',
      bulkRead: '全部已读',
      bulkResume: '批量恢复',
      noFilteredNotifications: '没有符合条件的通知',
      duration: '耗时',
      attempt: '第几次',
      time: '时间',
      scheduleReport: '生成报告',
      scheduleReportReady: '定时报告已生成',
      openScheduleReport: '打开报告',
      scheduleReportPath: '定时报告',
      scheduleReportHistory: '历史报告',
      bulkResult: '已处理 {ok} 条，失败 {failed} 条',
      retryFailed: '重试失败项',
      search: '搜索',
      searchPlaceholder: '搜索实验、命令、参数或指标',
      searchEmpty: '没有匹配的 run',
      reproduce: '复现',
      reproducing: '复现中…',
      reproduceConfirm: '将用相同命令与参数重跑，确认？',
      reproduced: '已复现并记录新 run',
      reproduceFailed: '复现失败：{reason}',
      reproduceFailedRun: '复现运行失败：{reason}',
      noCommand: '该 run 没有可复现的命令',
      edit: '编辑',
      name: '名称',
      description: '描述',
      save: '保存',
      cancel: '取消',
      tags: '标签',
      archived: '归档',
      archivedBadge: '已归档',
      showArchived: '显示归档',
      notesSaved: '备注已保存',
      experimentSaved: '实验已更新',
      updateFailed: '更新失败：{reason}',
      deleteRun: '删除 run',
      deleteRunConfirm: '删除这条 run 记录？（磁盘上的运行目录不会删除）',
      runDeleted: 'run 已删除',
      smallSample: '样本量 n<3：置信区间不可靠，建议增加重复实验',
      smallMultiples: '多指标对比',
      htmlReport: 'HTML 报告',
      exportLedger: '导出',
      importLedger: '导入',
      exportReady: '已导出：{path}',
      exportPackage: 'ZIP',
      importReady: '已导入：{summary}',
      importPrompt: '输入要导入的 ledger bundle 路径',
      importTitle: '导入台账',
      importDrop: '把 .json / .zip 文件拖到这里，或点击选择文件',
      importChoose: '选择文件',
      importBusy: '正在导入…',
      importSuccess: '导入完成：{summary}',
      importFailed: '导入失败：{reason}',
      openFolder: '打开台账…',
      openFolderTitle: '打开或新建台账',
      folderPath: '文件夹路径',
      folderPathHint: '可填项目文件夹（自动查找 .experiments）或台账文件夹',
      browseUp: '上一级',
      openHere: '打开此文件夹',
      createHere: '在这里新建台账',
      noLedgerHere: '这个文件夹还没有台账',
      dockSidebar: '停靠侧边栏',
      undockSidebar: '浮动窗口',
      closeDialog: '关闭',
      transferFailed: '导入/导出失败：{reason}',
      clone: '克隆',
      cloned: '已克隆：{name}',
      conclusion: '结论',
      conclusionPrompt: '输入实验结论（可先记录草稿，再通过/驳回）',
      conclusionSaved: '结论已保存',
      conclusionTitle: '记录结论',
      conclusionText: '结论内容',
      conclusionNote: '备注（可选）',
      conclusionHint: '可先保存草稿；通过/驳回会写入决策记录并签名。',
      reviewerName: '签名人 / 评审人',
      reviewerRole: '角色',
      reviewerHint: '签名密钥仍是本机 Ed25519 key；这里改的是签名上显示的人名和角色。',
      saveDraft: '保存草稿',
      conclusionFailed: '结论保存失败：{reason}',
      deleteExperiment: '删除实验',
      delete: '删除',
      confirmDelete: '确认删除？',
      deleteHint: '只从台账移除，不删除 run 文件和数据集。',
      deleteFailed: '删除失败：{reason}',
      deletedExperiment: '已从台账删除：{name}',
      confirmTitle: '请确认',
      confirmAction: '确认',
      approved: '通过',
      rejected: '驳回',
      draft: '草稿',
      reviewQueue: '评审',
      noReviews: '没有待审的草稿结论。',
      reviewApproved: '已通过：{count} 个实验',
      reviewRejected: '已驳回：{count} 个实验',
      approveAll: '全部通过',
      backToExperiments: '返回实验',
      manifest: '复现信息',
      git: 'git',
      toolchain: '工具链',
      env: '环境',
    }

    const en = {
      open: 'Experiments',
      title: 'Experiment ledger',
      close: 'Close',
      refresh: 'Refresh',
      root: 'Ledger directory',
      noRoots: 'No ledger yet. Ask the agent to run exp_define in a session and it will appear here.',
      noExperiments: 'No experiments in this directory yet. Create one with exp_define.',
      loading: 'Loading…',
      selectHint: 'Select an experiment on the left to see its runs.',
      runs: 'runs',
      runsCount: '{count} runs',
      runsShort: 'n',
      compare: 'Compare',
      group: 'Group',
      groupBy: 'Group by',
      groupAuto: 'Auto (varying factors)',
      groupNone: 'No grouping',
      groupAll: 'All factors',
      chartMetric: 'Chart metric',
      chartLabel: 'Metric comparison chart',
      noRuns: 'No runs yet. Add one with exp_run or exp_record.',
      factors: 'Factors',
      metrics: 'Metrics',
      label: 'Label',
      status: 'Status',
      duration: 'Duration',
      params: 'Params',
      metric: 'Metric',
      recordedAt: 'Recorded',
      artifacts: 'Artifacts',
      noArtifacts: 'No artifacts',
      datasets: 'Datasets',
      diffVsPrevious: 'Diff vs previous run',
      noChanges: 'No change',
      diffAdded: 'added',
      diffRemoved: 'removed',
      diffChanged: 'changed',
      stdout: 'Stdout (tail)',
      stderr: 'Stderr (tail)',
      notes: 'Notes',
      command: 'Command',
      back: 'Back',
      backToRuns: 'Back to runs',
      runDetail: 'Run detail',
      listFailed: 'Could not read the ledger: {reason}',
      detailFailed: 'Could not read the experiment: {reason}',
      networkFailed: 'Could not reach the app’s local service. Try again.',
      statusOk: 'ok',
      statusFailed: 'failed',
      statusTimeout: 'timeout',
      statusError: 'error',
      statusRecorded: 'recorded',
      hint: 'The ledger is written to <project>/.experiments; runs come from agent tools.',
      loadingDetail: 'Loading experiment…',
      candidates: 'Candidates',
      candidatesHint: 'Commands recorded from tool calls. Pick an experiment, then promote one into it.',
      noCandidates: 'No candidates yet. Run a bash/pwsh command and it will appear here.',
      promote: 'Promote',
      promoting: 'Promoting…',
      promoted: 'Promoted as {id}',
      promoteFailed: 'Promote failed: {reason}',
      promoteNeedsExperiment: 'Select an experiment first.',
      candidatesFailed: 'Could not read candidates: {reason}',
      generateReport: 'Generate report',
      generatingReport: 'Generating…',
      reportReady: 'Report generated',
      reportFailed: 'Report failed: {reason}',
      reportPath: 'Report path',
      copyPath: 'Copy path',
      copied: 'Copied',
      backToExperiments: 'Back to experiments',
      targetExperiment: 'Promote into',
      sweep: 'Sweep',
      sweepTitle: 'Parameter sweep',
      sweepCommand: 'Command template',
      sweepGrid: 'Grid (JSON)',
      sweepParallel: 'Parallel',
      sweepFailFast: 'Fail fast',
      sweepStart: 'Start sweep',
      sweepStop: 'Stop',
      sweepRunning: 'Running {done}/{total}',
      sweepDone: 'Done {done}/{total}',
      sweepStopped: 'Stopped {done}/{total}',
      sweepFailed: 'Sweep failed: {reason}',
      sweepInvalidGrid: 'Grid must be a JSON object, e.g. {"kp": [0.8, 1.2]}',
      sweepCommandRequired: 'The command template is required',
      sweepNoRuns: 'No results yet.',
      promoteFormTitle: 'Promote candidate',
      promoteLabel: 'Label',
      promoteParams: 'Params (JSON)',
      promoteMetrics: 'Metrics (JSON)',
      promoteConfirm: 'Promote',
      promoteCancel: 'Cancel',
      promoteInvalidJson: '{field} is not valid JSON',
      openReport: 'Open',
      openingReport: 'Opening…',
      openFailed: 'Open failed: {reason}',
      openedReport: 'Report opened',
      baseline: 'Baseline',
      baselineSet: 'Baseline set',
      baselineFailed: 'Baseline failed: {reason}',
      vsBaseline: 'Vs baseline',
      addBaseline: 'Add baseline',
      baselineRemove: 'Remove',
      compareExperiments: 'Compare experiments',
      compareHint: 'Tick 2–3 experiments, then press Compare experiments.',
      compareNeedTwo: 'Select at least two experiments.',
      compareMetric: 'Compare metric',
      compareGroup: 'Compare grouping',
      compareFailed: 'Compare failed: {reason}',
      compareBack: 'Back to experiments',
      multiCompareTitle: 'Multi-experiment comparison',
      exportCsv: 'Export CSV',
      exportMd: 'Export Markdown',
      exported: 'Exported: {path}',
      exportFailed: 'Export failed: {reason}',
      openExport: 'Open export',
      openedExport: 'Export opened',
      exportFile: 'Export file',
      preset: 'Preset',
      presetName: 'Preset name',
      presetSave: 'Save preset',
      presetSaved: 'Preset saved',
      presetFailed: 'Preset failed: {reason}',
      presetDelete: 'Delete preset',
      addCrossExperiment: 'Add experiment from another project',
      crossProject: 'Cross-project',
      compareReport: 'Generate comparison report',
      compareReportReady: 'Comparison report generated',
      compareReportFailed: 'Comparison report failed: {reason}',
      openCompareReport: 'Open comparison report',
      compareReportPath: 'Comparison report',
      schedule: 'Schedule',
      scheduleName: 'Schedule name',
      schedulePreset: 'Preset',
      scheduleInterval: 'Interval (minutes)',
      scheduleSave: 'Add schedule',
      scheduleDelete: 'Delete schedule',
      scheduleRun: 'Run now',
      schedulePause: 'Pause',
      scheduleResume: 'Resume',
      scheduleSaved: 'Schedule saved',
      scheduleFailed: 'Schedule failed: {reason}',
      scheduleEnabled: 'enabled',
      schedulePaused: 'paused',
      compareReports: 'Comparison reports',
      noCompareReports: 'No comparison reports yet.',
      compareReportsFailed: 'Could not read comparison reports: {reason}',
      notifications: 'Notifications',
      unreadNotifications: '{count} unread notifications',
      markAllRead: 'Mark all read',
      scheduleHistory: 'History {ok}/{total}',
      scheduleAvg: 'avg {ms} ms',
      scheduleNoHistory: 'No runs yet',
      viewNotification: 'View',
      retryLimit: 'Retries',
      retryDelay: 'Backoff (s)',
      retryStatus: 'Retry {count}/{limit}',
      notificationCenter: 'Notification center',
      noNotifications: 'No notifications',
      markRead: 'Mark read',
      failureLimit: 'Pause after failures',
      failureStatus: 'Failures {count}/{limit}',
      resumeRun: 'Resume and run',
      scheduleResumed: 'Resumed and started',
      scheduleDetail: 'Schedule detail',
      scheduleHistoryTitle: 'Run history',
      filterAll: 'All',
      filterLevel: 'Level',
      filterUnread: 'Unread only',
      bulkRead: 'Mark all read',
      bulkResume: 'Resume all',
      noFilteredNotifications: 'No notifications match the filter',
      duration: 'Duration',
      attempt: 'Attempt',
      time: 'Time',
      scheduleReport: 'Generate report',
      scheduleReportReady: 'Schedule report generated',
      openScheduleReport: 'Open report',
      scheduleReportPath: 'Schedule report',
      scheduleReportHistory: 'Past reports',
      bulkResult: 'Handled {ok}, failed {failed}',
      retryFailed: 'Retry failed',
      search: 'Search',
      searchPlaceholder: 'Search experiments, commands, params or metrics',
      searchEmpty: 'No matching runs',
      reproduce: 'Reproduce',
      reproducing: 'Reproducing…',
      reproduceConfirm: 'Rerun with the same command and params?',
      reproduced: 'Reproduced and recorded a new run',
      reproduceFailed: 'Reproduce failed: {reason}',
      reproduceFailedRun: 'Reproduced run failed: {reason}',
      noCommand: 'This run has no command to reproduce',
      edit: 'Edit',
      name: 'Name',
      description: 'Description',
      save: 'Save',
      cancel: 'Cancel',
      tags: 'Tags',
      archived: 'Archived',
      archivedBadge: 'archived',
      showArchived: 'Show archived',
      notesSaved: 'Notes saved',
      experimentSaved: 'Experiment updated',
      updateFailed: 'Update failed: {reason}',
      deleteRun: 'Delete run',
      deleteRunConfirm: 'Delete this run record? (the run directory on disk is kept)',
      runDeleted: 'Run deleted',
      smallSample: 'n<3: confidence intervals are unreliable; add repeats',
      smallMultiples: 'Small multiples',
      htmlReport: 'HTML report',
      exportLedger: 'Export',
      importLedger: 'Import',
      exportReady: 'Exported: {path}',
      exportPackage: 'ZIP',
      importReady: 'Imported: {summary}',
      importPrompt: 'Path of the ledger bundle to import',
      importTitle: 'Import ledger',
      importDrop: 'Drop a .json / .zip file here, or choose a file',
      importChoose: 'Choose file',
      importBusy: 'Importing…',
      importSuccess: 'Imported: {summary}',
      importFailed: 'Import failed: {reason}',
      openFolder: 'Open ledger…',
      openFolderTitle: 'Open or create a ledger',
      folderPath: 'Folder path',
      folderPathHint: 'A project folder (its .experiments is found) or a ledger folder',
      browseUp: 'Up',
      openHere: 'Open this folder',
      createHere: 'Create a ledger here',
      noLedgerHere: 'No ledger in this folder yet',
      dockSidebar: 'Dock to sidebar',
      undockSidebar: 'Float window',
      closeDialog: 'Close',
      transferFailed: 'Import/export failed: {reason}',
      clone: 'Clone',
      cloned: 'Cloned: {name}',
      conclusion: 'Conclusion',
      conclusionPrompt: 'Experiment conclusion (save a draft first, then approve/reject)',
      conclusionSaved: 'Conclusion saved',
      conclusionTitle: 'Record conclusion',
      conclusionText: 'Conclusion',
      conclusionNote: 'Note (optional)',
      conclusionHint: 'Save a draft first; approve/reject records and signs the decision.',
      reviewerName: 'Signer / reviewer',
      reviewerRole: 'Role',
      reviewerHint: 'The signature key stays the local Ed25519 key; this changes the displayed name/role.',
      saveDraft: 'Save draft',
      conclusionFailed: 'Could not save conclusion: {reason}',
      deleteExperiment: 'Delete experiment',
      delete: 'Delete',
      confirmDelete: 'Delete?',
      deleteHint: 'Removes it from the ledger; run files and datasets stay on disk.',
      deleteFailed: 'Delete failed: {reason}',
      deletedExperiment: 'Removed from ledger: {name}',
      confirmTitle: 'Confirm',
      confirmAction: 'Confirm',
      approved: 'Approve',
      rejected: 'Reject',
      draft: 'Draft',
      reviewQueue: 'Reviews',
      noReviews: 'No draft conclusions waiting for review.',
      reviewApproved: 'Approved: {count} experiments',
      reviewRejected: 'Rejected: {count} experiments',
      approveAll: 'Approve all',
      backToExperiments: 'Back to experiments',
      manifest: 'Reproducibility',
      git: 'git',
      toolchain: 'Toolchain',
      env: 'Environment',
    }

    /** Initial view state. */
    const INITIAL = {
      open: false,
      loading: false,
      roots: [],
      root: null,
      experiments: [],
      selectedId: null,
      detail: null,
      detailLoading: false,
      runId: null,
      error: null,
      candidatesOpen: false,
      candidates: [],
      candidateLoading: false,
      notice: null,
      busy: null,
      report: null,
      sweepOpen: false,
      sweepJob: null,
      baselineOptions: null,
      compareIds: [],
      compareExtra: [],
      crossRoots: null,
      compareOpen: false,
      multiCompare: null,
      multiCompareLoading: false,
      multiMetric: '',
      multiGroup: '',
      compareExport: null,
      compareReport: null,
      compareReports: [],
      notifications: [],
      notificationCenterOpen: false,
      allNotifications: [],
      allNotificationsLoading: false,
      scheduleDetailId: null,
      scheduleReport: null,
      scheduleReports: [],
      bulkResult: null,
      searchOpen: false,
      searchResults: [],
      searchLoading: false,
      searchQuery: '',
      searchStatus: '',
      showArchived: false,
      reviewOpen: false,
      reviews: [],
      reviewLoading: false,
      sidebar: false,
      rootOpen: false,
      rootPath: '',
      browse: null,
      browseLoading: false,
      browseError: null,
      rootBusy: false,
      rootCreate: false,
      importOpen: false,
      importBusy: false,
      importError: null,
      importFileName: null,
      importResult: null,
      pendingDeleteId: null,
      conclusionOpen: false,
      conclusionText: '',
      conclusionStatus: 'draft',
      conclusionNote: '',
      conclusionBusy: false,
      conclusionError: null,
      reviewerName: '',
      reviewerRole: 'reviewer',
      confirm: null,
    }

    /**
     * One shared snapshot store, in the shape the renderer accepts as a bare
     * observable source.
     * @param initial - first snapshot.
     * @returns the store with `getSnapshot`, `subscribe`, and `set`.
     */
    function createStore(initial) {
      let value = initial
      const listeners = new Set()
      return {
        getSnapshot: () => value,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        set: (next) => {
          value = next
          for (const listener of [...listeners]) listener()
        },
      }
    }

    /**
     * Call one package-owned Host route.
     * @param path - route path with query.
     * @param options - optional method and JSON body.
     * @returns the JSON payload.
     */
    async function request(path, options = {}) {
      const headers = { [REQUEST_HEADER]: '1' }
      if (options.body !== undefined) headers['content-type'] = 'application/json'
      let response
      try {
        response = await fetch(`${ENDPOINT}${path}`, {
          method: options.method ?? 'GET',
          headers,
          credentials: 'same-origin',
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        })
      } catch {
        const error = new Error('network')
        error.network = true
        throw error
      }
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok || payload === null || payload.ok !== true) {
        throw new Error(payload?.error ?? `HTTP ${response.status}`)
      }
      return payload
    }

    /**
     * @param error - anything thrown.
     * @returns a readable message.
     */
    function messageOf(error) {
      return error instanceof Error ? error.message : String(error)
    }

    /**
     * Height of the DSH title bar, so a docked panel starts below it.
     * @returns inset in pixels (0 when there is no title bar).
     */
    function titlebarInset() {
      if (typeof document === 'undefined') return 0
      const candidates = [document.documentElement, document.body, document.querySelector('[data-windows-titlebar]')]
      const carrier = candidates.find(element => element !== null && element.hasAttribute?.('data-windows-titlebar'))
      if (carrier !== undefined && carrier !== null) {
        const raw = getComputedStyle(carrier).getPropertyValue('--dsh-windows-titlebar-height').trim()
        const pixels = Number.parseFloat(raw)
        if (Number.isFinite(pixels) && pixels > 0) return pixels
        const area = navigator.windowControlsOverlay
        if (area !== undefined && typeof area.getTitlebarAreaRect === 'function') {
          const rect = area.getTitlebarAreaRect()
          if (rect !== null && rect.height > 0) return rect.height
        }
        return 42
      }
      return 0
    }

    /**
     * Read a browser File as base64 without a huge single spread.
     * @param file - File from an input or drop.
     * @returns base64 string.
     */
    async function fileToBase64(file) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
      }
      return btoa(binary)
    }

    /**
     * @param time - epoch milliseconds.
     * @returns a short local date-time, or an empty string.
     */
    function formatTime(time) {
      if (typeof time !== 'number' || !Number.isFinite(time) || time <= 0) return ''
      try {
        return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(time))
      } catch {
        return new Date(time).toLocaleString()
      }
    }

    /**
     * @param ms - duration in milliseconds.
     * @returns a compact duration.
     */
    function formatDuration(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—'
      if (ms === 0) return '—'
      if (ms < 1000) return `${Math.round(ms)}ms`
      if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
      const minutes = Math.floor(ms / 60_000)
      const seconds = Math.round((ms % 60_000) / 1000)
      return `${minutes}m ${seconds}s`
    }

    /**
     * @param value - metric or param value.
     * @returns a compact display string.
     */
    function formatValue(value) {
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) return String(value)
        if (Number.isInteger(value)) return String(value)
        return String(Math.round(value * 1000) / 1000)
      }
      return String(value)
    }

    /**
     * Summarize one numeric series (same formula as the Host's compare module).
     * @param values - metric values.
     * @returns {{n: number, mean: number | null, sd: number | null, min: number | null, max: number | null}} the summary.
     */
    function summarize(values) {
      const nums = values.filter((value) => typeof value === 'number' && Number.isFinite(value))
      if (nums.length === 0) return { n: 0, mean: null, sd: null, min: null, max: null, ci95: null, smallSample: true }
      const mean = nums.reduce((sum, value) => sum + value, 0) / nums.length
      const variance = nums.length > 1
        ? nums.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (nums.length - 1)
        : 0
      const sd = Math.sqrt(variance)
      const se = nums.length > 1 ? sd / Math.sqrt(nums.length) : null
      const critical = tCritical95(nums.length - 1)
      return {
        n: nums.length,
        mean,
        sd,
        min: Math.min(...nums),
        max: Math.max(...nums),
        ci95: se === null ? null : [mean - critical * se, mean + critical * se],
        smallSample: nums.length < 3,
      }
    }

    /** Two-sided 95% t critical value (table for small df, normal approximation after). */
    function tCritical95(df) {
      const table = [
        0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262,
        2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093,
        2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
      ]
      if (!Number.isFinite(df) || df <= 0) return 1.96
      return df <= 30 ? table[Math.floor(df)] ?? 2.042 : 1.96 + 2.4 / df
    }

    /**
     * Group runs and summarize metrics locally, so the panel compares the same
     * records the Host tool would.
     * @param experiment - experiment detail.
     * @param groupBy - factor keys.
     * @returns {{metrics: object[], groups: object[]}} the comparison.
     */
    function compareLocal(experiment, groupBy) {
      const runs = Array.isArray(experiment.runs) ? experiment.runs : []
      const declared = Array.isArray(experiment.metrics) ? experiment.metrics : []
      const keys = []
      for (const metric of declared) keys.push(metric.key)
      for (const run of runs) for (const key of Object.keys(run.metrics ?? {})) if (!keys.includes(key)) keys.push(key)
      const metrics = keys.map((key) => declared.find((metric) => metric.key === key) ?? { key, label: key, direction: 'none' })
      const buckets = new Map()
      for (const run of runs) {
        const label = groupBy.length === 0
          ? 'all runs'
          : groupBy.map((key) => `${key}=${run.params?.[key] === undefined ? '—' : formatValue(run.params[key])}`).join(', ')
        if (!buckets.has(label)) buckets.set(label, [])
        buckets.get(label).push(run)
      }
      const groups = [...buckets.entries()].map(([label, entries]) => ({
        label,
        runs: entries.length,
        stats: Object.fromEntries(metrics.map((metric) => [
          metric.key,
          summarize(entries.map((run) => run.metrics?.[metric.key]).filter((value) => value !== undefined)),
        ])),
      }))
      groups.sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }))
      return { metrics, groups }
    }

    /**
     * @param value - number to format.
     * @returns three-decimal shorthand.
     */
    function formatNumber(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      return String(Math.round(value * 1000) / 1000)
    }

    /**
     * @param value - a delta.
     * @returns the number with an explicit plus sign when positive.
     */
    function formatSigned(value) {
      const text = formatNumber(value)
      return value > 0 ? `+${text}` : text
    }

    /**
     * @param experiment - experiment detail.
     * @returns its baselines, including a legacy single `baseline`.
     */
    function baselinesOf(experiment) {
      const list = Array.isArray(experiment.baselines)
        ? experiment.baselines.filter(entry => entry !== null && typeof entry === 'object')
        : []
      if (list.length > 0) return list
      return experiment.baseline !== null && typeof experiment.baseline === 'object'
        ? [{ id: 'baseline-legacy', name: 'baseline', ...experiment.baseline }]
        : []
    }

    /**
     * Changed keys between two flat objects.
     * @param left - baseline object.
     * @param right - target object.
     * @returns changed rows.
     */
    function diffEntries(left, right) {
      const keys = [...new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])].sort()
      const rows = []
      for (const key of keys) {
        const before = left?.[key]
        const after = right?.[key]
        if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) continue
        rows.push({ key, before, after })
      }
      return rows
    }

    /**
     * Artifact changes between two runs.
     * @param left - baseline artifacts.
     * @param right - target artifacts.
     * @returns changed artifact rows.
     */
    function diffArtifactsLocal(left, right) {
      const map = new Map()
      for (const artifact of left ?? []) map.set(artifact.path, { left: artifact })
      for (const artifact of right ?? []) {
        const entry = map.get(artifact.path) ?? {}
        entry.right = artifact
        map.set(artifact.path, entry)
      }
      const rows = []
      for (const [path, entry] of map) {
        const before = entry.left?.sha256 ?? ''
        const after = entry.right?.sha256 ?? ''
        const state = entry.left === undefined ? 'added' : entry.right === undefined ? 'removed' : before === after ? 'same' : 'changed'
        if (state !== 'same') rows.push({ path, state })
      }
      return rows
    }

    /**
     * @param text - label text.
     * @param limit - maximum characters.
     * @returns the shortened label.
     */
    function shortLabel(text, limit = 14) {
      const value = String(text)
      return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
    }

    /**
     * @param {object[]} runs - runs in the experiment.
     * @param {object[]} factors - declared factors.
     * @returns {string[]} keys whose value changes between runs.
     */
    function varyingKeys(runs, factors) {
      const varying = factors
        .map(factor => factor.key)
        .filter(key => new Set(runs.map(run => JSON.stringify(run.params?.[key] ?? null))).size > 1)
      return varying.length > 0 ? varying : factors.map(factor => factor.key)
    }

    /**
     * @param status - run status.
     * @param t - translate function.
     * @returns the localized status label.
     */
    function statusText(status, t) {
      switch (status) {
        case 'ok': return t('statusOk')
        case 'failed': return t('statusFailed')
        case 'timeout': return t('statusTimeout')
        case 'error': return t('statusError')
        case 'recorded': return t('statusRecorded')
        default: return status ?? '—'
      }
    }

    /**
     * The sidebar footer button, beside Settings.
     * @param props - owner props (`wide`) plus the injected opener and locale.
     * @returns the action row.
     */
    function FooterAction({ wide, open, t, pollPanelRequest }) {
      React.useEffect(() => {
        if (typeof pollPanelRequest !== 'function') return undefined
        let cancelled = false
        const tick = () => {
          if (!cancelled) void pollPanelRequest()
        }
        const timer = setInterval(tick, 2000)
        tick()
        return () => {
          cancelled = true
          clearInterval(timer)
        }
      }, [pollPanelRequest])
      const label = t('open')
      return h(React.Fragment, null, h(Styles), h('button', {
        type: 'button',
        className: 'xpl-foot',
        'data-rail': wide ? undefined : 'true',
        title: label,
        'aria-label': label,
        'aria-haspopup': 'dialog',
        onClick: open,
      }, h(IconFlask, { size: 16 }), wide ? h('span', { className: 'xpl-foot-label' }, label) : null))
    }

    /**
     * The `shell.overlay` entry: nothing while closed, otherwise the panel.
     * @param props - injected store hook, actions, and locale.
     * @returns the dialog or null.
     */
    function SearchView({ t, results, loading, query, status, onQuery, onStatus, onSearch, onBack, onOpen }) {
      return h('div', { className: 'xpl-body' },
        h('div', { className: 'xpl-main xpl-candidates' },
          h('div', { className: 'xpl-cand-head' },
            h('h3', { className: 'xpl-compare-title' }, t('search')),
            h('button', { type: 'button', className: 'xpl-link', onClick: onBack }, t('compareBack'))),
          h('div', { className: 'xpl-form-row' },
            h('input', {
              className: 'xpl-input xpl-search-input',
              value: query,
              placeholder: t('searchPlaceholder'),
              onChange: (event) => onQuery(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') onSearch()
              },
            }),
            h('select', {
              className: 'xpl-select xpl-select-sm',
              value: status,
              onChange: (event) => onStatus(event.target.value),
            },
            h('option', { value: '' }, t('filterAll')),
            h('option', { value: 'ok' }, 'ok'),
            h('option', { value: 'failed' }, 'failed'),
            h('option', { value: 'recorded' }, 'recorded')),
            h('button', { type: 'button', className: 'xpl-primary', onClick: onSearch }, t('search'))),
          loading
            ? h('div', { className: 'xpl-empty' }, t('loading'))
            : results.length === 0
              ? h('div', { className: 'xpl-empty' }, t('searchEmpty'))
              : h('div', { className: 'xpl-search-list' }, results.map(result => h('button', {
                key: `${result.experimentId}:${result.run.id}`,
                type: 'button',
                className: 'xpl-row',
                onClick: () => onOpen(result),
              },
              h('span', { className: 'xpl-row-title' }, `${result.experimentName} · ${result.run.id}`),
              h('span', { className: 'xpl-row-meta' },
                `${result.run.status} · ${Object.entries(result.run.params ?? {}).map(([key, value]) => `${key}=${formatValue(value)}`).join(', ') || '—'}`),
              h('span', { className: 'xpl-row-meta' },
                Object.entries(result.run.metrics ?? {}).map(([key, value]) => `${key}=${formatValue(value)}`).join(', ') || '—'))))))
    }

    function ScheduleChart({ history, values, label, t }) {
      const width = 720
      const height = 180
      const pad = 26
      const max = Math.max(...values, 1)
      const step = (width - pad * 2) / Math.max(values.length, 1)
      const barWidth = Math.max(4, step - 6)
      return h('svg', { className: 'xpl-chart', viewBox: `0 0 ${width} ${height}`, width: '100%', height, role: 'img' },
        h('line', {
          x1: pad, y1: height - pad, x2: width - pad, y2: height - pad,
          stroke: 'var(--dsw-alias-border-l1)',
        }),
        h('text', { x: pad, y: 16, fill: 'var(--dsw-alias-label-secondary)', fontSize: 11 }, label),
        h('text', {
          x: width - pad, y: 16, fill: 'var(--dsw-alias-label-secondary)', fontSize: 11, textAnchor: 'end',
        }, formatNumber(max)),
        values.map((value, index) => {
          const barHeight = Math.max(2, Math.round((Math.max(value, 0) / max) * (height - pad - 28)))
          return h('rect', {
            key: index,
            x: Math.round(pad + index * step + 3),
            y: height - pad - barHeight,
            width: barWidth,
            height: barHeight,
            fill: history[index]?.status === 'done'
              ? 'var(--dsw-alias-state-success-primary)'
              : 'var(--dsw-alias-state-error-primary)',
          }, h('title', null, `#${index + 1} ${history[index]?.status ?? ''} · ${formatNumber(value)}`))
        }))
    }

    function ScheduleDetailView({ schedule, t, onBack, onRun, onToggle, reportFile, onReport, onOpenReport, reports, busy }) {
      const history = Array.isArray(schedule.history) ? schedule.history : []
      const metricKeys = [...new Set(history.flatMap((entry) => Object.keys(entry.metrics ?? {})))]
      const [metricKey, setMetricKey] = React.useState('')
      const [copied, setCopied] = React.useState(false)
      const selected = metricKeys.includes(metricKey) ? metricKey : null
      const values = history.map((entry) => selected === null
        ? (entry.durationMs ?? 0)
        : Number(entry.metrics?.[selected] ?? 0))
      return h('div', { className: 'xpl-body' },
        h('div', { className: 'xpl-main xpl-candidates' },
          h('div', { className: 'xpl-cand-head' },
            h('h3', { className: 'xpl-compare-title' }, `${t('scheduleDetail')} · ${schedule.name}`),
            h('button', { type: 'button', className: 'xpl-link', onClick: onBack }, t('compareBack'))),
          h('div', { className: 'xpl-form-row' },
            h('span', { className: 'xpl-muted' },
              `${schedule.preset} · ${Math.round((schedule.intervalMs ?? 0) / 60000)}m · ${schedule.enabled === false ? t('schedulePaused') : t('scheduleEnabled')}${schedule.lastStatus ? ` · ${schedule.lastStatus}` : ''}`),
            metricKeys.length === 0 ? null : h('label', { className: 'xpl-inline-field' }, t('compareMetric'),
              h('select', {
                className: 'xpl-select xpl-select-sm',
                value: selected ?? '',
                onChange: (event) => setMetricKey(event.target.value),
              },
              h('option', { value: '' }, t('duration')),
              metricKeys.map(key => h('option', { key, value: key }, key)))),
            h('button', { type: 'button', className: 'xpl-link', onClick: () => onRun(schedule.id) }, t('scheduleRun')),
            h('button', {
              type: 'button',
              className: 'xpl-link',
              onClick: () => onToggle(schedule.id, schedule.enabled === false),
            }, schedule.enabled === false ? t('scheduleResume') : t('schedulePause')),
            h('button', {
              type: 'button',
              className: 'xpl-primary',
              disabled: busy === 'scheduleReport',
              onClick: () => onReport(schedule.id),
            }, busy === 'scheduleReport' ? t('generatingReport') : t('scheduleReport'))),
          history.length === 0
            ? h('div', { className: 'xpl-empty' }, t('scheduleNoHistory'))
            : h(React.Fragment, null,
              h(ScheduleChart, { history, values, label: selected ?? t('duration'), t }),
              h('div', { className: 'xpl-field-label' }, t('scheduleHistoryTitle')),
              h('div', { className: 'xpl-table-wrap' },
                h('table', { className: 'xpl-table' },
                  h('thead', null, h('tr', null,
                    h('th', null, t('attempt')),
                    h('th', null, t('time')),
                    h('th', null, t('group')),
                    h('th', null, t('duration')),
                    h('th', null, selected ?? ''))),
                  h('tbody', null, history.map((entry, index) => h('tr', { key: entry.jobId ?? index },
                    h('td', null, String(index + 1)),
                    h('td', null, typeof entry.startedAt === 'number' ? new Date(entry.startedAt).toLocaleString() : '—'),
                    h('td', { className: 'xpl-td-strong' }, entry.status),
                    h('td', null, typeof entry.durationMs === 'number' ? `${formatNumber(entry.durationMs)} ms` : '—'),
                    h('td', null, selected === null ? '—' : formatNumber(entry.metrics?.[selected] ?? 0))))))),
              reportFile == null ? null : h('div', { className: 'xpl-report' },
                h('span', { className: 'xpl-muted' }, `${t('scheduleReportPath')}: `),
                h('code', { className: 'xpl-code' }, reportFile.relative),
                h('button', {
                  type: 'button',
                  className: 'xpl-link',
                  onClick: () => {
                    if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return
                    void navigator.clipboard.writeText(reportFile.path).then(() => setCopied(true)).catch(() => {})
                  },
                }, copied ? t('copied') : t('copyPath')),
                h('button', { type: 'button', className: 'xpl-link', onClick: onOpenReport }, t('openScheduleReport'))),
              (reports ?? []).length === 0 ? null : h('div', { className: 'xpl-field' },
                h('div', { className: 'xpl-field-label' }, t('scheduleReportHistory')),
                h('ul', { className: 'xpl-artifacts' }, reports.map(report => h('li', { key: report.id },
                  h('code', { className: 'xpl-code' }, report.path),
                  ' ',
                  h('button', {
                    type: 'button',
                    className: 'xpl-link',
                    onClick: () => onOpenReport(report.path),
                  }, t('openScheduleReport')))))))))
    }

    function NotificationCenterView({ items, loading, t, onBack, onOpen, onMarkRead, onResume, onBulkRead, onBulkResume, bulkResult, onRetryFailed }) {
      const [filterRoot, setFilterRoot] = React.useState('')
      const [filterLevel, setFilterLevel] = React.useState('')
      const [unreadOnly, setUnreadOnly] = React.useState(false)
      const all = items ?? []
      const roots = [...new Set(all.map(note => note.root).filter(root => typeof root === 'string'))]
      const filtered = all.filter(note => (filterRoot === '' || note.root === filterRoot)
        && (filterLevel === '' || note.level === filterLevel)
        && (!unreadOnly || note.read !== true))
      const groups = new Map()
      for (const item of filtered) {
        const key = typeof item.root === 'string' ? item.root : ''
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(item)
      }
      const resumable = filtered.filter(note => note.action === 'resume-run').length
      return h('div', { className: 'xpl-body' },
        h('div', { className: 'xpl-main xpl-candidates' },
          h('div', { className: 'xpl-cand-head' },
            h('h3', { className: 'xpl-compare-title' }, t('notificationCenter')),
            h('button', { type: 'button', className: 'xpl-link', onClick: onBack }, t('compareBack'))),
          h('div', { className: 'xpl-form-row' },
            h('label', { className: 'xpl-inline-field' }, t('root'),
              h('select', {
                className: 'xpl-select xpl-select-sm',
                value: filterRoot,
                onChange: (event) => setFilterRoot(event.target.value),
              },
              h('option', { value: '' }, t('filterAll')),
              roots.map(root => h('option', { key: root, value: root }, shortPath(root))))),
            h('label', { className: 'xpl-inline-field' }, t('filterLevel'),
              h('select', {
                className: 'xpl-select xpl-select-sm',
                value: filterLevel,
                onChange: (event) => setFilterLevel(event.target.value),
              },
              h('option', { value: '' }, t('filterAll')),
              h('option', { value: 'info' }, 'info'),
              h('option', { value: 'error' }, 'error'))),
            h('label', { className: 'xpl-inline-field' },
              h('input', {
                type: 'checkbox',
                checked: unreadOnly,
                onChange: (event) => setUnreadOnly(event.target.checked),
              }),
              t('filterUnread')),
            h('button', {
              type: 'button',
              className: 'xpl-link',
              disabled: filtered.every(note => note.read === true),
              onClick: () => onBulkRead(filtered),
            }, t('bulkRead')),
            h('button', {
              type: 'button',
              className: 'xpl-link',
              disabled: resumable === 0,
              onClick: () => onBulkResume(filtered),
            }, `${t('bulkResume')} (${resumable})`)),
          bulkResult == null ? null : h('div', { className: 'xpl-notice' },
            t('bulkResult', { ok: bulkResult.ok, failed: bulkResult.failed }),
            bulkResult.failed > 0 && (bulkResult.failedNotes ?? []).length > 0
              ? h('button', {
                type: 'button',
                className: 'xpl-link',
                onClick: () => onRetryFailed(bulkResult.failedNotes),
              }, t('retryFailed'))
              : null),
          loading
            ? h('div', { className: 'xpl-empty' }, t('loading'))
            : filtered.length === 0
              ? h('div', { className: 'xpl-empty' }, all.length === 0 ? t('noNotifications') : t('noFilteredNotifications'))
              : h('div', { className: 'xpl-notification-list' }, [...groups].map(([root, list]) => h('div', { key: root, className: 'xpl-field' },
                h('div', { className: 'xpl-field-label' }, shortPath(root)),
                list.map(note => h('div', { key: `${root}:${note.id}`, className: 'xpl-form-row' },
                  h('span', { className: note.level === 'error' ? 'xpl-warn' : 'xpl-muted' }, note.text),
                  h('button', { type: 'button', className: 'xpl-link', onClick: () => onOpen(note) }, t('viewNotification')),
                  note.action === 'resume-run' ? h('button', {
                    type: 'button',
                    className: 'xpl-link',
                    onClick: () => onResume(note),
                  }, t('resumeRun')) : null,
                  note.read === true ? null : h('button', { type: 'button', className: 'xpl-link', onClick: () => onMarkRead(note) }, t('markRead')))))))))
    }

    /**
     * Review queue: draft conclusions waiting for approve/reject.
     * @param props - reviews, loading, locale and callbacks.
     * @returns the view.
     */
    function ReviewView({ reviews, loading, t, onBack, onDecision, onApproveAll, reviewerName, reviewerRole, onName, onRole }) {
      return h('div', { className: 'xpl-body' },
        h('div', { className: 'xpl-body-head' },
          h('button', { type: 'button', className: 'xpl-link', onClick: onBack }, t('backToExperiments')),
          h('h3', { className: 'xpl-body-title' }, t('reviewQueue')),
          h('button', {
            type: 'button',
            className: 'xpl-primary',
            disabled: reviews.length === 0,
            onClick: onApproveAll,
          }, t('approveAll'))),
        h('div', { className: 'xpl-form-row xpl-reviewer-row' },
          h('label', { className: 'xpl-field' },
            h('span', { className: 'xpl-field-label' }, t('reviewerName')),
            h('input', {
              className: 'xpl-input',
              value: reviewerName,
              placeholder: t('reviewerName'),
              onChange: (event) => onName(event.target.value),
            })),
          h('label', { className: 'xpl-field' },
            h('span', { className: 'xpl-field-label' }, t('reviewerRole')),
            h('input', {
              className: 'xpl-input',
              value: reviewerRole,
              placeholder: 'reviewer',
              onChange: (event) => onRole(event.target.value),
            }))),
        loading ? h('div', { className: 'xpl-empty' }, t('loading')) : reviews.length === 0
          ? h('div', { className: 'xpl-empty' }, t('noReviews'))
          : h('div', { className: 'xpl-runs' }, reviews.map((review) => h('div', { key: review.id, className: 'xpl-review-row' },
            h('div', null,
              h('strong', null, review.name),
              h('span', { className: 'xpl-muted' }, ` · ${review.id} · ${review.runs} runs`)),
            h('div', { className: 'xpl-desc' }, review.conclusion?.text ?? '—'),
            h('div', { className: 'xpl-form-row' },
              h('button', { type: 'button', className: 'xpl-primary', onClick: () => onDecision([review.id], 'approved') }, t('approved')),
              h('button', { type: 'button', className: 'xpl-link', onClick: () => onDecision([review.id], 'rejected') }, t('rejected')))))))
    }

    /**
     * Folder picker: browse directories, open a project/ledger folder, or
     * create a fresh `.experiments` ledger.
     * @param props - picker state and callbacks.
     * @returns the modal.
     */
    function RootPicker({ state, t, onBrowse, onPath, onOpen, onCreate, onOpenPath, onClose }) {
      const browse = state.browse
      return h('div', { className: 'xpl-dialog-mask', onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() } },
        h('div', { className: 'xpl-dialog', role: 'dialog', 'aria-label': t('openFolderTitle') },
          h('div', { className: 'xpl-dialog-head' },
            h('h3', null, t('openFolderTitle')),
            h('button', { type: 'button', className: 'xpl-icon-button', 'aria-label': t('closeDialog'), onClick: onClose }, '×')),
          h('label', { className: 'xpl-field' },
            h('span', { className: 'xpl-field-label' }, t('folderPath')),
            h('input', {
              className: 'xpl-input',
              value: state.rootPath,
              placeholder: browse?.dir ?? '',
              onChange: (event) => onPath(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') onOpen(false) },
            })),
          h('div', { className: 'xpl-muted xpl-dialog-hint' }, t('folderPathHint')),
          h('div', { className: 'xpl-form-row' },
            h('button', { type: 'button', className: 'xpl-link', disabled: browse === null || browse.parent === null, onClick: () => onBrowse(browse.parent) }, `↑ ${t('browseUp')}`),
            h('button', { type: 'button', className: 'xpl-primary', disabled: state.rootBusy || (state.rootPath.trim() === '' && browse === null), onClick: () => onOpen(false) }, t('openHere')),
            h('button', { type: 'button', className: 'xpl-link', disabled: state.rootBusy || (state.rootPath.trim() === '' && browse === null), onClick: () => onCreate() }, t('createHere'))),
          browse === null ? null : h('div', { className: 'xpl-dialog-dir' },
            h('div', { className: 'xpl-muted' }, browse.dir),
            state.browseError !== null ? h('div', { className: 'xpl-warn' }, state.browseError) : null,
            state.browseLoading ? h('div', { className: 'xpl-empty' }, t('loading')) : h('div', { className: 'xpl-dir-list' },
              browse.entries.map((entry) => h('button', {
                key: entry.path,
                type: 'button',
                className: 'xpl-dir-row',
                onClick: () => (entry.ledger ? onOpenPath(entry.path) : onBrowse(entry.path)),
              }, h('span', null, entry.name), entry.ledger ? h('span', { className: 'xpl-badge' }, 'ledger') : null)))))
        )
    }

    /**
     * Generic in-panel confirmation (replaces window.confirm in the webview).
     * @param props - confirm data, locale and callbacks.
     * @returns the modal.
     */
    function ConfirmDialog({ confirm, t, onYes, onClose }) {
      return h('div', { className: 'xpl-dialog-mask', onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() } },
        h('div', { className: 'xpl-dialog', role: 'dialog', 'aria-label': t('confirmTitle') },
          h('div', { className: 'xpl-dialog-head' },
            h('h3', null, t('confirmTitle')),
            h('button', { type: 'button', className: 'xpl-icon-button', 'aria-label': t('closeDialog'), onClick: onClose }, '×')),
          h('div', { className: 'xpl-dialog-hint' }, confirm.message),
          h('div', { className: 'xpl-form-row' },
            h('button', { type: 'button', className: confirm.danger === true ? 'xpl-primary xpl-danger' : 'xpl-primary', onClick: onYes }, confirm.label ?? t('confirmAction')),
            h('button', { type: 'button', className: 'xpl-link', onClick: onClose }, t('cancel'))))
      )
    }

    /**
     * Conclusion modal: draft text plus approve/reject decisions.
     * @param props - conclusion draft state, locale and callbacks.
     * @returns the modal.
     */
    function ConclusionDialog({ state, t, onText, onNote, onName, onRole, onSave, onClose }) {
      return h('div', { className: 'xpl-dialog-mask', onMouseDown: (event) => { if (event.target === event.currentTarget && !state.conclusionBusy) onClose() } },
        h('div', { className: 'xpl-dialog', role: 'dialog', 'aria-label': t('conclusionTitle') },
          h('div', { className: 'xpl-dialog-head' },
            h('h3', null, t('conclusionTitle')),
            h('button', { type: 'button', className: 'xpl-icon-button', 'aria-label': t('closeDialog'), disabled: state.conclusionBusy, onClick: onClose }, '×')),
          h('label', { className: 'xpl-field' },
            h('span', { className: 'xpl-field-label' }, t('conclusionText')),
            h('textarea', {
              className: 'xpl-textarea',
              value: state.conclusionText,
              autoFocus: true,
              onChange: (event) => onText(event.target.value),
            })),
          h('label', { className: 'xpl-field' },
            h('span', { className: 'xpl-field-label' }, t('conclusionNote')),
            h('input', {
              className: 'xpl-input',
              value: state.conclusionNote,
              onChange: (event) => onNote(event.target.value),
            })),
          h('div', { className: 'xpl-form-row' },
            h('label', { className: 'xpl-field' },
              h('span', { className: 'xpl-field-label' }, t('reviewerName')),
              h('input', {
                className: 'xpl-input',
                value: state.reviewerName,
                placeholder: t('reviewerName'),
                onChange: (event) => onName(event.target.value),
              })),
            h('label', { className: 'xpl-field' },
              h('span', { className: 'xpl-field-label' }, t('reviewerRole')),
              h('input', {
                className: 'xpl-input',
                value: state.reviewerRole,
                placeholder: 'reviewer',
                onChange: (event) => onRole(event.target.value),
              }))),
          h('div', { className: 'xpl-muted xpl-dialog-hint' }, t('reviewerHint')),
          h('div', { className: 'xpl-muted xpl-dialog-hint' }, t('conclusionHint')),
          h('div', { className: 'xpl-form-row' },
            h('button', { type: 'button', className: 'xpl-primary', disabled: state.conclusionBusy, onClick: () => onSave('draft') }, t('saveDraft')),
            h('button', { type: 'button', className: 'xpl-primary', disabled: state.conclusionBusy, onClick: () => onSave('approved') }, t('approved')),
            h('button', { type: 'button', className: 'xpl-link', disabled: state.conclusionBusy, onClick: () => onSave('rejected') }, t('rejected')),
            h('button', { type: 'button', className: 'xpl-link', disabled: state.conclusionBusy, onClick: onClose }, t('cancel'))),
          state.conclusionError !== null ? h('div', { className: 'xpl-warn' }, state.conclusionError) : null)
      )
    }

    /**
     * Import modal: drag/drop or choose a .json/.zip bundle.
     * @param props - state, locale and callbacks.
     * @returns the modal.
     */
    function ImportDialog({ state, t, onFile, onClose }) {
      const inputRef = React.useRef(null)
      const pick = () => {
        if (inputRef.current !== null) inputRef.current.click()
      }
      return h('div', { className: 'xpl-dialog-mask', onMouseDown: (event) => { if (event.target === event.currentTarget && !state.importBusy) onClose() } },
        h('div', { className: 'xpl-dialog', role: 'dialog', 'aria-label': t('importTitle') },
          h('div', { className: 'xpl-dialog-head' },
            h('h3', null, t('importTitle')),
            h('button', { type: 'button', className: 'xpl-icon-button', 'aria-label': t('closeDialog'), disabled: state.importBusy, onClick: onClose }, '×')),
          h('div', {
            className: 'xpl-dropzone',
            onDragOver: (event) => event.preventDefault(),
            onDrop: (event) => {
              event.preventDefault()
              const file = event.dataTransfer?.files?.[0]
              if (file !== undefined) onFile(file)
            },
            onClick: state.importBusy ? undefined : pick,
            role: 'button',
            tabIndex: 0,
            onKeyDown: (event) => { if (event.key === 'Enter' && !state.importBusy) pick() },
          },
          h('div', { className: 'xpl-drop-title' }, t('importDrop')),
          h('div', { className: 'xpl-muted' }, state.importFileName ?? 'ledger.json / ledger.zip'),
          h('button', { type: 'button', className: 'xpl-primary', disabled: state.importBusy, onClick: (event) => { event.stopPropagation(); pick() } }, t('importChoose')),
          h('input', {
            ref: inputRef,
            type: 'file',
            accept: '.json,.zip,application/json,application/zip',
            style: { display: 'none' },
            onChange: (event) => {
              const file = event.target.files?.[0]
              if (file !== undefined) onFile(file)
            },
          })),
          state.importBusy ? h('div', { className: 'xpl-muted' }, t('importBusy')) : null,
          state.importError !== null ? h('div', { className: 'xpl-warn' }, state.importError) : null,
          state.importResult !== null ? h('div', { className: 'xpl-ok' }, state.importResult) : null)
      )
    }

    function Dialog(props) {
      const { useDialog, t } = props
      const state = useDialog(snapshot => snapshot)
      const panelRef = React.useRef(null)
      const inset = titlebarInset()
      const panelStyle = state.sidebar && inset > 0 ? { top: `${inset}px` } : undefined

      React.useEffect(() => {
        if (!state.open || !state.sidebar) return undefined
        const panel = panelRef.current
        const column = document.querySelector('[class*="_centerCol"]')
        if (panel === null || column === null) return undefined
        const apply = () => {
          column.style.marginRight = `${Math.round(panel.getBoundingClientRect().width)}px`
        }
        apply()
        window.addEventListener('resize', apply)
        return () => {
          window.removeEventListener('resize', apply)
          column.style.marginRight = ''
        }
      }, [state.open, state.sidebar])

      React.useEffect(() => {
        if (!state.open) return undefined
        const panel = panelRef.current
        const previous = document.activeElement
        if (panel !== null) panel.focus()
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            props.close()
            return
          }
          if (event.key !== 'Tab' || panel === null) return
          const focusable = panel.querySelectorAll(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
          )
          if (focusable.length === 0) return
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
          document.removeEventListener('keydown', onKeyDown, true)
          if (previous !== null && typeof previous.focus === 'function') previous.focus()
        }
      }, [state.open])

      React.useEffect(() => {
        if (state.root === null) return undefined
        void props.loadNotifications()
        const timer = setInterval(() => { void props.loadNotifications() }, 20_000)
        return () => clearInterval(timer)
      }, [state.root])

      if (!state.open) return null

      const selected = state.experiments.find(experiment => experiment.id === state.selectedId) ?? null
      const selectedRuns = state.detail?.runs?.length ?? 0
      const compareIds = state.compareIds ?? []
      const compareTotal = compareIds.length + (state.compareExtra?.length ?? 0)
      const visibleExperiments = state.showArchived === true
        ? state.experiments
        : state.experiments.filter(experiment => experiment.archived !== true)
      const unread = (state.notifications ?? []).filter((note) => note.read !== true)
      const latest = unread[0]

      const header = h('header', { className: 'xpl-head' },
        h('h2', { className: 'xpl-title', id: 'xpl-title' }, t('title')),
        h('span', { className: 'xpl-count' }, selected === null ? String(state.experiments.length) : String(selectedRuns)),
        h('button', {
          type: 'button',
          className: 'xpl-link',
          title: t('openFolderTitle'),
          onClick: props.openRootPicker,
        }, t('openFolder')),
        state.roots.length > 0 ? h('select', {
          className: 'xpl-select',
          value: state.root ?? '',
          title: t('root'),
          'aria-label': t('root'),
          disabled: state.loading,
          onChange: (event) => props.chooseRoot(event.target.value),
        }, state.roots.map(entry => h('option', { key: entry.path, value: entry.path }, shortPath(entry.path)))) : null,
        h('button', {
          type: 'button',
          className: 'xpl-link',
          'data-active': state.candidatesOpen ? 'true' : undefined,
          onClick: state.candidatesOpen ? props.closeCandidates : props.openCandidates,
        }, state.candidatesOpen ? t('backToExperiments') : t('candidates')),
        h('button', {
          type: 'button',
          className: 'xpl-link',
          disabled: compareTotal < 2,
          onClick: state.compareOpen ? props.closeCompare : props.openCompare,
        }, state.compareOpen ? t('compareBack') : `${t('compareExperiments')} (${compareTotal})`),
        h('button', {
          type: 'button',
          className: 'xpl-link',
          onClick: props.openSearch,
        }, t('search')),
        h('button', {
          type: 'button',
          className: 'xpl-link',
          onClick: props.openReviews,
        }, t('reviewQueue')),
        h('button', {
          type: 'button',
          className: 'xpl-link',
          onClick: props.openNotificationCenter,
        }, `${t('notificationCenter')}${unread.length > 0 ? ` (${unread.length})` : ''}`),
        h('button', {
          type: 'button',
          className: 'xpl-link',
          disabled: state.root === null,
          onClick: props.exportLedger,
        }, t('exportLedger')),
        h('button', {
          type: 'button',
          className: 'xpl-link',
          disabled: state.root === null,
          onClick: props.exportLedgerZip,
        }, t('exportPackage')),
        h('button', {
          type: 'button',
          className: 'xpl-link',
          title: state.root === null ? t('openFolderTitle') : t('importTitle'),
          onClick: state.root === null ? props.openRootPicker : props.openImport,
        }, t('importLedger')),
        h('button', {
          type: 'button',
          className: 'xpl-link',
          disabled: state.loading,
          onClick: props.refresh,
        }, t('refresh')),
        h('button', {
          type: 'button',
          className: 'xpl-icon-button',
          'aria-label': state.sidebar ? t('undockSidebar') : t('dockSidebar'),
          title: state.sidebar ? t('undockSidebar') : t('dockSidebar'),
          onClick: props.toggleSidebar,
        }, state.sidebar ? '⇤' : '⇥'),
        h('button', {
          type: 'button',
          className: 'xpl-icon-button',
          'aria-label': t('close'),
          title: t('close'),
          onClick: props.close,
        }, h(IconClose, { size: 14 })))

      const scheduleDetail = state.scheduleDetailId === null
        ? null
        : (state.detail?.schedules ?? []).find(entry => entry.id === state.scheduleDetailId) ?? null

      let body
      if (state.reviewOpen) {
        body = h(ReviewView, {
          reviews: state.reviews ?? [],
          loading: state.reviewLoading,
          t,
          reviewerName: state.reviewerName ?? '',
          reviewerRole: state.reviewerRole ?? 'reviewer',
          onName: props.setReviewerName,
          onRole: props.setReviewerRole,
          onBack: props.closeReviews,
          onDecision: props.reviewExperiments,
          onApproveAll: props.approveAllReviews,
        })
      } else if (state.searchOpen) {
        body = h(SearchView, {
          t,
          results: state.searchResults ?? [],
          loading: state.searchLoading,
          query: state.searchQuery ?? '',
          status: state.searchStatus ?? '',
          onQuery: props.setSearchQuery,
          onStatus: props.setSearchStatus,
          onSearch: props.runSearch,
          onBack: props.closeSearch,
          onOpen: props.openSearchResult,
        })
      } else if (scheduleDetail !== null) {
        body = h(ScheduleDetailView, {
          schedule: scheduleDetail,
          t,
          onBack: props.closeScheduleDetail,
          onRun: props.runSchedule,
          onToggle: props.toggleSchedule,
          reportFile: state.scheduleReport,
          onReport: props.reportSchedule,
          onOpenReport: props.openScheduleReport,
          reports: state.scheduleReports ?? [],
          busy: state.busy,
        })
      } else if (state.notificationCenterOpen) {
        body = h(NotificationCenterView, {
          items: state.allNotifications,
          loading: state.allNotificationsLoading,
          t,
          onBack: props.closeNotificationCenter,
          onOpen: props.openAllNotification,
          onMarkRead: props.markCenterNotificationRead,
          onResume: props.resumeSchedule,
          onBulkRead: props.markNotificationsReadBulk,
          onBulkResume: props.resumeSchedules,
          bulkResult: state.bulkResult,
          onRetryFailed: props.resumeSchedules,
        })
      } else if (state.compareOpen) {
        body = h(MultiCompareView, {
          data: state.multiCompare,
          loading: state.multiCompareLoading,
          metric: state.multiMetric,
          group: state.multiGroup,
          t,
          onMetric: props.setMultiCompareMetric,
          onGroup: props.setMultiCompareGroup,
          onRefresh: props.loadMultiCompare,
          onBack: props.closeCompare,
          exportFile: state.compareExport,
          onExport: props.exportCompare,
          onOpenExport: props.openCompareExport,
          compareExtra: state.compareExtra ?? [],
          crossRoots: state.crossRoots,
          currentRoot: state.root,
          onAddExtra: props.addCompareExtra,
          onRemoveExtra: props.removeCompareExtra,
          reportFile: state.compareReport,
          onReport: () => props.reportCompare('markdown'),
          onReportHtml: () => props.reportCompare('html'),
          onOpenReport: props.openCompareReport,
          reports: state.compareReports ?? [],
          busy: state.busy,
        })
      } else if (state.candidatesOpen) {
        body = h(CandidatesView, {
          candidates: state.candidates,
          loading: state.candidateLoading,
          experiments: state.experiments,
          selectedId: state.selectedId,
          busy: state.busy,
          t,
          onSelectExperiment: props.chooseExperiment,
          onPromote: props.promote,
          onBack: props.closeCandidates,
        })
      } else if (state.error !== null) {
        body = h('div', { className: 'xpl-body' },
          h('div', { className: 'xpl-alert', role: 'alert' }, state.error),
          state.roots.length === 0 && state.experiments.length === 0 ? h('div', { className: 'xpl-empty' }, t('noRoots')) : null)
      } else if (state.loading && state.experiments.length === 0) {
        body = h('div', { className: 'xpl-body' }, h('div', { className: 'xpl-empty' }, t('loading')))
      } else if (state.roots.length === 0) {
        body = h('div', { className: 'xpl-body' }, h('div', { className: 'xpl-empty' }, t('noRoots')))
      } else if (state.experiments.length === 0) {
        body = h('div', { className: 'xpl-body' }, h('div', { className: 'xpl-empty' }, t('noExperiments')))
      } else {
        body = h('div', { className: 'xpl-body' },
          h('ul', { className: 'xpl-side' },
          h('li', { className: 'xpl-side-filter' },
            h('label', { className: 'xpl-inline-field' },
              h('input', {
                type: 'checkbox',
                checked: state.showArchived === true,
                onChange: props.toggleShowArchived,
              }),
              t('showArchived'))),
          visibleExperiments.map(experiment => h(ExperimentRow, {
            key: experiment.id,
            experiment,
            selected: experiment.id === state.selectedId,
            compareSelected: compareIds.includes(experiment.id),
            t,
            onSelect: () => props.chooseExperiment(experiment.id),
            onToggleCompare: () => props.toggleCompare(experiment.id),
            pendingDelete: state.pendingDeleteId === experiment.id,
            onAskDelete: () => props.askDeleteExperiment(experiment.id),
            onDelete: () => props.deleteExperiment(experiment.id),
            onCancelDelete: props.cancelDeleteExperiment,
          }))),
          h('div', { className: 'xpl-main' },
            state.detailLoading ? h('div', { className: 'xpl-empty' }, t('loadingDetail'))
              : state.detail === null ? h('div', { className: 'xpl-empty' }, t('selectHint'))
                : h(ExperimentView, {
                  experiment: state.detail,
                  runId: state.runId,
                  t,
                  onSelectRun: props.chooseRun,
                  onBackToRuns: props.backToRuns,
                  busy: state.busy,
                  onReproduce: props.reproduceRun,
                  onUpdateExperiment: props.updateExperiment,
                  onUpdateRun: props.updateRun,
                  onDeleteRun: props.deleteRun,
                  onClone: props.cloneExperiment,
                  onConclude: props.openConclusion,
                  report: state.report,
                  onReport: () => props.generateReport('markdown'),
                  onReportHtml: () => props.generateReport('html'),
                  sweepOpen: state.sweepOpen,
                  sweepJob: state.sweepJob,
                  onToggleSweep: props.toggleSweep,
                  onStartSweep: props.startSweep,
                  onRefreshSweep: props.refreshSweep,
                  onStopSweep: props.stopSweep,
                  baselines: baselinesOf(state.detail),
                  baselineOptions: state.baselineOptions,
                  onAddBaseline: props.addBaseline,
                  onRemoveBaseline: props.removeBaseline,
                  onSavePreset: props.savePreset,
                  onDeletePreset: props.deletePreset,
                  onSaveSchedule: props.saveSchedule,
                  onDeleteSchedule: props.deleteSchedule,
                  onToggleSchedule: props.toggleSchedule,
                  onRunSchedule: props.runSchedule,
                  onOpenScheduleDetail: props.openScheduleDetail,
                  onOpenReport: props.openReport,
                })))
      }

      const footer = h('footer', { className: 'xpl-footbar' },
        h('div', { className: 'xpl-muted' }, t('hint')))

      return h(React.Fragment, null,
        h('div', { className: `xpl-overlay${state.sidebar ? ' xpl-overlay-sidebar' : ''}` },
          state.sidebar ? null : h('div', { className: 'xpl-mask', 'aria-hidden': true, onMouseDown: props.close }),
          h('div', {
            className: `xpl-panel${state.sidebar ? ' xpl-panel-sidebar' : ''}`,
            role: 'dialog',
            'aria-modal': state.sidebar ? undefined : 'true',
            'aria-labelledby': 'xpl-title',
            tabIndex: -1,
            ref: panelRef,
            style: panelStyle,
          }, header,
          latest === undefined ? null : h('div', { className: 'xpl-notice-bar', role: 'status' },
            h('button', {
              type: 'button',
              className: 'xpl-notice-text xpl-notice-link',
              onClick: () => props.openNotification(latest),
            }, latest.text),
            unread.length > 1 ? h('span', { className: 'xpl-muted' }, `+${unread.length - 1}`) : null,
            h('button', { type: 'button', className: 'xpl-link', onClick: () => props.openNotification(latest) }, t('viewNotification')),
            latest.action === 'resume-run' ? h('button', {
              type: 'button',
              className: 'xpl-link',
              onClick: () => props.resumeSchedule(latest),
            }, t('resumeRun')) : null,
            h('button', { type: 'button', className: 'xpl-link', onClick: props.markNotificationsRead }, t('markAllRead'))),
          state.notice != null ? h('div', { className: 'xpl-notice', role: 'status' }, state.notice) : null, body,
          state.rootOpen ? h(RootPicker, {
            state,
            t,
            onBrowse: props.browseRoots,
            onPath: props.setRootPath,
            onOpen: props.openRootFolder,
            onCreate: () => props.openRootFolder(true),
            onOpenPath: (path) => props.openRootPath(path, false),
            onClose: props.closeRootPicker,
          }) : null,
          state.importOpen ? h(ImportDialog, {
            state,
            t,
            onFile: props.importFile,
            onClose: props.closeImport,
          }) : null,
          state.conclusionOpen ? h(ConclusionDialog, {
            state,
            t,
            onText: props.setConclusionText,
            onNote: props.setConclusionNote,
            onName: props.setReviewerName,
            onRole: props.setReviewerRole,
            onSave: props.saveConclusion,
            onClose: props.closeConclusion,
          }) : null,
          state.confirm !== null && state.confirm !== undefined ? h(ConfirmDialog, {
            confirm: state.confirm,
            t,
            onYes: props.confirmYes,
            onClose: props.closeConfirm,
          }) : null,
          footer)),
        h(Styles))
    }

    /**
     * @param path - absolute path.
     * @returns the last two path segments.
     */
    function shortPath(path) {
      const parts = String(path).split(/[\\/]+/).filter(Boolean)
      return parts.length <= 2 ? String(path) : `…/${parts.slice(-2).join('/')}`
    }

    /**
     * One experiment row in the left list.
     * @param props - experiment summary, selection state, and callback.
     * @returns the list item.
     */
    function ExperimentRow({ experiment, selected, compareSelected, t, onSelect, onToggleCompare, pendingDelete, onAskDelete, onDelete, onCancelDelete }) {
      const meta = [
        experiment.archived === true ? t('archivedBadge') : '',
        t('runsCount', { count: experiment.runs }),
        experiment.lastStatus === '' ? '' : statusText(experiment.lastStatus, t),
        formatTime(experiment.updatedAt),
      ].filter(Boolean).join(' · ')
      return h('li', { className: 'xpl-row-wrap' },
        h('input', {
          type: 'checkbox',
          className: 'xpl-check',
          checked: compareSelected === true,
          'aria-label': t('compare'),
          onChange: onToggleCompare,
        }),
        h('button', {
          type: 'button',
          className: 'xpl-row',
          'data-selected': selected ? 'true' : undefined,
          onClick: onSelect,
        },
        h('span', { className: 'xpl-row-title' }, experiment.name),
        h('span', { className: 'xpl-row-meta' }, meta),
        h('span', { className: 'xpl-row-id' }, experiment.id)),
        pendingDelete === true
          ? h('span', { className: 'xpl-row-confirm' },
            h('span', { className: 'xpl-muted' }, t('confirmDelete')),
            h('button', { type: 'button', className: 'xpl-link xpl-danger', onClick: onDelete }, t('delete')),
            h('button', { type: 'button', className: 'xpl-link', onClick: onCancelDelete }, t('cancel')))
          : h('button', {
            type: 'button',
            className: 'xpl-row-delete',
            title: `${t('deleteExperiment')} · ${t('deleteHint')}`,
            'aria-label': t('deleteExperiment'),
            onClick: onAskDelete,
          }, '×'))
    }

    /**
     * The right pane: experiment header, runs table, and one run's detail.
     * @param props - experiment, selected run, and callbacks.
     * @returns the pane.
     */
    /**
     * The candidate list: commands recorded passively, promotable into the selected experiment.
     * @param props - candidates, experiments, selection, busy state and actions.
     * @returns the candidate body.
     */
    function CandidatesView({ candidates, loading, experiments, selectedId, busy, t, onSelectExperiment, onPromote, onBack }) {
      const [target, setTarget] = React.useState(null)
      const [label, setLabel] = React.useState('')
      const [paramsText, setParamsText] = React.useState('')
      const [metricsText, setMetricsText] = React.useState('')
      const [formError, setFormError] = React.useState('')

      const submit = () => {
        if (target === null) return
        const values = {}
        if (label.trim() !== '') values.label = label.trim()
        try {
          if (paramsText.trim() !== '') values.params = JSON.parse(paramsText)
        } catch {
          setFormError(t('promoteInvalidJson', { field: t('promoteParams') }))
          return
        }
        try {
          if (metricsText.trim() !== '') values.metrics = JSON.parse(metricsText)
        } catch {
          setFormError(t('promoteInvalidJson', { field: t('promoteMetrics') }))
          return
        }
        setFormError('')
        onPromote(target.id, values)
        setTarget(null)
        setLabel('')
        setParamsText('')
        setMetricsText('')
      }

      const table = loading
        ? h('div', { className: 'xpl-empty' }, t('loading'))
        : candidates.length === 0
          ? h('div', { className: 'xpl-empty' }, t('noCandidates'))
          : h('div', { className: 'xpl-table-wrap' },
            h('table', { className: 'xpl-table' },
              h('thead', null, h('tr', null,
                h('th', null, t('command')),
                h('th', null, t('status')),
                h('th', null, t('duration')),
                h('th', null, 'Tool'),
                h('th', null, ''))),
              h('tbody', null, candidates.map(candidate => h('tr', { key: candidate.id },
                h('td', null, h('code', { className: 'xpl-code' }, shortCommand(candidate.command))),
                h('td', null, h('span', { className: 'xpl-status', 'data-status': candidate.status }, statusText(candidate.status, t))),
                h('td', null, formatDuration(candidate.durationMs)),
                h('td', null, candidate.tool),
                h('td', null, h('button', {
                  type: 'button',
                  className: 'xpl-primary',
                  disabled: busy === candidate.id || selectedId === null,
                  onClick: () => {
                    setTarget(candidate)
                    setLabel('')
                    setParamsText('')
                    setMetricsText('')
                    setFormError('')
                  },
                }, busy === candidate.id ? t('promoting') : t('promote'))))))))

      const form = target === null ? null : h('div', { className: 'xpl-form' },
        h('div', { className: 'xpl-cand-head' },
          h('h4', { className: 'xpl-compare-title' }, t('promoteFormTitle')),
          h('button', { type: 'button', className: 'xpl-link', onClick: () => setTarget(null) }, t('promoteCancel'))),
        h('code', { className: 'xpl-code' }, shortCommand(target.command)),
        h('label', { className: 'xpl-field' },
          h('span', { className: 'xpl-field-label-sm' }, t('promoteLabel')),
          h('input', { className: 'xpl-input', value: label, onChange: (event) => setLabel(event.target.value) })),
        h('label', { className: 'xpl-field' },
          h('span', { className: 'xpl-field-label-sm' }, t('promoteParams')),
          h('textarea', {
            className: 'xpl-textarea',
            value: paramsText,
            placeholder: '{"kp": 1.2}',
            onChange: (event) => setParamsText(event.target.value),
          })),
        h('label', { className: 'xpl-field' },
          h('span', { className: 'xpl-field-label-sm' }, t('promoteMetrics')),
          h('textarea', {
            className: 'xpl-textarea',
            value: metricsText,
            placeholder: '{"overshoot": 4.2}',
            onChange: (event) => setMetricsText(event.target.value),
          })),
        formError === '' ? null : h('div', { className: 'xpl-warn' }, formError),
        h('button', { type: 'button', className: 'xpl-primary', disabled: busy === target.id, onClick: submit }, t('promoteConfirm')))

      return h('div', { className: 'xpl-body' },
        h('div', { className: 'xpl-main xpl-candidates' },
          h('div', { className: 'xpl-cand-head' },
            h('h3', { className: 'xpl-compare-title' }, t('candidates')),
            h('button', { type: 'button', className: 'xpl-link', onClick: onBack }, t('backToExperiments'))),
          h('p', { className: 'xpl-desc' }, t('candidatesHint')),
          h('div', { className: 'xpl-chips' },
            h('label', { className: 'xpl-inline-field' },
              h('span', null, t('targetExperiment')),
              h('select', {
                className: 'xpl-select xpl-select-sm',
                value: selectedId ?? '',
                onChange: (event) => onSelectExperiment(event.target.value),
              },
              h('option', { value: '' }, '—'),
              experiments.map(experiment => h('option', { key: experiment.id, value: experiment.id }, experiment.name))))),
          table,
          form))
    }

    /**
     * @param command - recorded command.
     * @returns one shortened line.
     */
    function shortCommand(command) {
      const line = String(command).split(/\r?\n/)[0]
      return line.length <= 110 ? line : `${line.slice(0, 109)}…`
    }

    /**
     * The sweep form and the live progress of one background job.
     * @param props - job, locale and actions.
     * @returns the sweep section.
     */
    function Sparkline({ values, colors, width = 120, height = 22 }) {
      if (!Array.isArray(values) || values.length === 0) return null
      const max = Math.max(...values, 1)
      const step = width / values.length
      return h('svg', { className: 'xpl-spark', width, height, viewBox: `0 0 ${width} ${height}` },
        values.map((value, index) => {
          const barHeight = Math.max(2, Math.round((Math.max(value, 0) / max) * height))
          return h('rect', {
            key: index,
            x: Math.round(index * step),
            y: height - barHeight,
            width: Math.max(1, Math.floor(step) - 1),
            height: barHeight,
            fill: colors?.[index] ?? 'var(--dsw-alias-brand-primary)',
          })
        }))
    }

    function ScheduleRow({ schedule, t, onOpenDetail, onRunSchedule, onToggleSchedule, onDeleteSchedule }) {
      const history = Array.isArray(schedule.history) ? schedule.history : []
      const ok = history.filter((entry) => entry.status === 'done').length
      const durations = history.map((entry) => Math.max(1, entry.durationMs ?? ((entry.endedAt ?? 0) - (entry.startedAt ?? 0))))
      const colors = history.map((entry) => entry.status === 'done'
        ? 'var(--dsw-alias-state-success-primary)'
        : 'var(--dsw-alias-state-error-primary)')
      const metricKey = history.flatMap((entry) => Object.keys(entry.metrics ?? {}))[0] ?? null
      const metricValues = metricKey === null ? [] : history.map((entry) => Number(entry.metrics?.[metricKey] ?? 0))
      const avg = durations.length === 0 ? null : Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      return h('div', { className: 'xpl-form-row' },
        h('button', { type: 'button', className: 'xpl-link', onClick: () => onOpenDetail(schedule.id) }, schedule.name),
        h('span', { className: 'xpl-muted' },
          `${schedule.preset} · ${Math.round((schedule.intervalMs ?? 0) / 60000)}m · ${schedule.enabled === false ? t('schedulePaused') : t('scheduleEnabled')}${schedule.lastStatus ? ` · ${schedule.lastStatus}` : ''}${schedule.retryLimit ? ` · ${t('retryStatus', { count: schedule.retryCount ?? 0, limit: schedule.retryLimit })}` : ''}${schedule.failureLimit ? ` · ${t('failureStatus', { count: schedule.failureCount ?? 0, limit: schedule.failureLimit })}` : ''}`),
        h('span', { className: 'xpl-muted' }, history.length === 0
          ? t('scheduleNoHistory')
          : `${t('scheduleHistory', { ok, total: history.length })}${avg === null ? '' : ` · ${t('scheduleAvg', { ms: avg })}`}`),
        h('span', { className: 'xpl-trend' },
          h(Sparkline, { values: durations, colors }),
          metricKey === null ? null : h(Sparkline, { values: metricValues }),
          metricKey === null ? null : h('span', { className: 'xpl-muted' }, metricKey)),
        h('button', { type: 'button', className: 'xpl-link', onClick: () => onRunSchedule(schedule.id) }, t('scheduleRun')),
        h('button', {
          type: 'button',
          className: 'xpl-link',
          onClick: () => onToggleSchedule(schedule.id, schedule.enabled === false),
        }, schedule.enabled === false ? t('scheduleResume') : t('schedulePause')),
        h('button', { type: 'button', className: 'xpl-link', onClick: () => onDeleteSchedule(schedule.id) }, t('scheduleDelete')))
    }

    function SweepPanel({
      job, t, presets, onSavePreset, onDeletePreset,
      schedules, onSaveSchedule, onDeleteSchedule, onToggleSchedule, onRunSchedule, onOpenScheduleDetail,
      onStart, onRefresh, onStop,
    }) {
      const [command, setCommand] = React.useState('')
      const [grid, setGrid] = React.useState('{"kp": [0.8, 1.2]}')
      const [parallel, setParallel] = React.useState('1')
      const [failFast, setFailFast] = React.useState(false)
      const [presetName, setPresetName] = React.useState('')
      const [scheduleName, setScheduleName] = React.useState('')
      const [schedulePreset, setSchedulePreset] = React.useState('')
      const [scheduleInterval, setScheduleInterval] = React.useState('60')
      const [retryLimit, setRetryLimit] = React.useState('0')
      const [retryDelay, setRetryDelay] = React.useState('60')
      const [failureLimit, setFailureLimit] = React.useState('0')
      const [formError, setFormError] = React.useState('')
      const running = job !== null && job.status === 'running'

      const applyPreset = (id) => {
        const preset = (presets ?? []).find(entry => entry.id === id)
        if (preset === undefined) return
        setCommand(preset.command ?? '')
        setGrid(JSON.stringify(preset.grid ?? {}))
        setParallel(String(preset.maxParallel ?? 1))
        setFailFast(preset.failFast === true)
        setFormError('')
      }

      const parseGrid = () => {
        try {
          const parsed = JSON.parse(grid)
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
          return parsed
        } catch {
          return null
        }
      }

      const save = () => {
        if (presetName.trim() === '') {
          setFormError(t('presetName'))
          return
        }
        if (command.trim() === '') {
          setFormError(t('sweepCommandRequired'))
          return
        }
        const parsed = parseGrid()
        if (parsed === null) {
          setFormError(t('sweepInvalidGrid'))
          return
        }
        setFormError('')
        onSavePreset(presetName.trim(), {
          command: command.trim(),
          grid: parsed,
          maxParallel: Number(parallel) || 1,
          failFast,
        })
        setPresetName('')
      }

      const saveScheduleForm = () => {
        const name = scheduleName.trim()
        const preset = schedulePreset !== '' ? schedulePreset : (presets[0]?.name ?? '')
        const minutes = Number(scheduleInterval)
        const retries = Number(retryLimit)
        const delaySeconds = Number(retryDelay)
        if (name === '') {
          setFormError(t('scheduleName'))
          return
        }
        if (preset === '') {
          setFormError(t('presetName'))
          return
        }
        if (!Number.isFinite(minutes) || minutes < 1) {
          setFormError(t('scheduleInterval'))
          return
        }
        if (!Number.isInteger(retries) || retries < 0 || retries > 5) {
          setFormError(t('retryLimit'))
          return
        }
        if (!Number.isFinite(delaySeconds) || delaySeconds < 10 || delaySeconds > 3600) {
          setFormError(t('retryDelay'))
          return
        }
        const failures = Number(failureLimit)
        if (!Number.isInteger(failures) || failures < 0 || failures > 10) {
          setFormError(t('failureLimit'))
          return
        }
        setFormError('')
        onSaveSchedule(name, preset, minutes, {
          retryLimit: retries,
          retryDelayMs: delaySeconds * 1000,
          failureLimit: failures,
        })
        setScheduleName('')
      }

      React.useEffect(() => {
        if (!running) return undefined
        const timer = setInterval(() => { onRefresh() }, 1000)
        return () => clearInterval(timer)
      }, [job?.id, running])

      const submit = () => {
        if (command.trim() === '') {
          setFormError(t('sweepCommandRequired'))
          return
        }
        let parsed
        try {
          parsed = JSON.parse(grid)
        } catch {
          setFormError(t('sweepInvalidGrid'))
          return
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setFormError(t('sweepInvalidGrid'))
          return
        }
        setFormError('')
        onStart({ command: command.trim(), grid: parsed, maxParallel: Number(parallel) || 1, failFast })
      }

      const status = job === null
        ? ''
        : job.status === 'running'
          ? t('sweepRunning', { done: job.done, total: job.total })
          : job.status === 'stopped'
            ? t('sweepStopped', { done: job.done, total: job.total })
            : t('sweepDone', { done: job.done, total: job.total })
      const progress = job === null || job.total === 0 ? 0 : Math.round((job.done / job.total) * 100)

      return h('div', { className: 'xpl-sweep' },
        h('h4', { className: 'xpl-compare-title' }, t('sweepTitle')),
        h('div', { className: 'xpl-form' },
          h('div', { className: 'xpl-form-row' },
            h('label', { className: 'xpl-inline-field' }, t('preset'),
              h('select', {
                className: 'xpl-select xpl-select-sm',
                value: '',
                onChange: (event) => {
                  applyPreset(event.target.value)
                  event.target.value = ''
                },
              },
              h('option', { value: '' }, '—'),
              (presets ?? []).map(preset => h('option', { key: preset.id, value: preset.id }, preset.name)))),
            h('input', {
              className: 'xpl-input xpl-preset-name',
              value: presetName,
              placeholder: t('presetName'),
              onChange: (event) => setPresetName(event.target.value),
            }),
            h('button', { type: 'button', className: 'xpl-link', onClick: save }, t('presetSave')),
            (presets ?? []).map(preset => h('span', { key: preset.id, className: 'xpl-baseline-chip' },
              preset.name,
              h('button', {
                type: 'button',
                className: 'xpl-chip-remove',
                title: t('presetDelete'),
                onClick: () => onDeletePreset(preset.id),
              }, '×')))),
          h('div', { className: 'xpl-form-row' },
            h('span', { className: 'xpl-field-label-sm' }, t('schedule')),
            h('input', {
              className: 'xpl-input xpl-preset-name',
              value: scheduleName,
              placeholder: t('scheduleName'),
              onChange: (event) => setScheduleName(event.target.value),
            }),
            h('select', {
              className: 'xpl-select xpl-select-sm',
              value: schedulePreset !== '' ? schedulePreset : (presets[0]?.name ?? ''),
              onChange: (event) => setSchedulePreset(event.target.value),
            }, (presets ?? []).map(preset => h('option', { key: preset.id, value: preset.name }, preset.name))),
            h('input', {
              className: 'xpl-input xpl-preset-name',
              type: 'number',
              min: 1,
              value: scheduleInterval,
              onChange: (event) => setScheduleInterval(event.target.value),
            }),
            h('input', {
              className: 'xpl-input xpl-preset-name',
              type: 'number',
              min: 0,
              max: 5,
              title: t('retryLimit'),
              value: retryLimit,
              onChange: (event) => setRetryLimit(event.target.value),
            }),
            h('input', {
              className: 'xpl-input xpl-preset-name',
              type: 'number',
              min: 10,
              max: 3600,
              title: t('retryDelay'),
              value: retryDelay,
              onChange: (event) => setRetryDelay(event.target.value),
            }),
            h('input', {
              className: 'xpl-input xpl-preset-name',
              type: 'number',
              min: 0,
              max: 10,
              title: t('failureLimit'),
              value: failureLimit,
              onChange: (event) => setFailureLimit(event.target.value),
            }),
            h('button', { type: 'button', className: 'xpl-link', onClick: saveScheduleForm }, t('scheduleSave'))),
          h('label', { className: 'xpl-field' },
            h('span', { className: 'xpl-field-label-sm' }, t('sweepCommand')),
            h('input', {
              className: 'xpl-input',
              value: command,
              placeholder: 'python tune.py --kp {kp}',
              onChange: (event) => setCommand(event.target.value),
            })),
          h('label', { className: 'xpl-field' },
            h('span', { className: 'xpl-field-label-sm' }, t('sweepGrid')),
            h('textarea', {
              className: 'xpl-textarea',
              value: grid,
              onChange: (event) => setGrid(event.target.value),
            })),
          h('div', { className: 'xpl-form-row' },
            h('label', { className: 'xpl-inline-field' }, t('sweepParallel'),
              h('select', {
                className: 'xpl-select xpl-select-sm',
                value: parallel,
                onChange: (event) => setParallel(event.target.value),
              }, ['1', '2', '3', '4'].map((value) => h('option', { key: value, value }, value)))),
            h('label', { className: 'xpl-inline-field' },
              h('input', { type: 'checkbox', checked: failFast, onChange: (event) => setFailFast(event.target.checked) }),
              t('sweepFailFast')),
            h('button', { type: 'button', className: 'xpl-primary', disabled: running, onClick: submit }, t('sweepStart')),
            running ? h('button', { type: 'button', className: 'xpl-link', onClick: onStop }, t('sweepStop')) : null),
          formError === '' ? null : h('div', { className: 'xpl-warn' }, formError)),
        (schedules ?? []).length === 0 ? null : h('div', { className: 'xpl-schedule-list' },
          schedules.map(schedule => h(ScheduleRow, {
            key: schedule.id,
            schedule,
            t,
            onOpenDetail: onOpenScheduleDetail,
            onRunSchedule,
            onToggleSchedule,
            onDeleteSchedule,
          }))),
        job === null ? null : h('div', { className: 'xpl-field' },
          h('div', { className: 'xpl-muted' }, status),
          h('div', { className: 'xpl-progress' }, h('span', { style: { width: `${progress}%` } })),
          job.errors.length > 0 ? h('div', { className: 'xpl-warn' }, job.errors.map((entry) => `${entry.index + 1}: ${entry.error}`).join('; ')) : null,
          job.runs.length === 0
            ? h('div', { className: 'xpl-muted' }, t('sweepNoRuns'))
            : h('div', { className: 'xpl-table-wrap' },
              h('table', { className: 'xpl-table' },
                h('thead', null, h('tr', null,
                  h('th', null, '#'),
                  h('th', null, t('params')),
                  h('th', null, t('status')),
                  h('th', null, t('duration')),
                  h('th', null, t('metrics')))),
                h('tbody', null, job.runs.map((run, index) => h('tr', { key: run.id },
                  h('td', null, String(index + 1)),
                  h('td', null, Object.entries(run.params ?? {}).map(([key, value]) => `${key}=${formatValue(value)}`).join(', ')),
                  h('td', null, h('span', { className: 'xpl-status', 'data-status': run.status }, statusText(run.status, t))),
                  h('td', null, formatDuration(run.durationMs)),
                  h('td', null, Object.entries(run.metrics ?? {}).map(([key, value]) => `${key}=${formatValue(value)}`).join(', ')))))))))
    }

    /**
     * Side-by-side comparison of 2-4 experiments: one metric, shared grouping.
     * @param props - comparison payload, controls and locale.
     * @returns the compare body.
     */
    function MultiCompareView({
      data, loading, metric, group, t, onMetric, onGroup, onRefresh, onBack,
      exportFile, onExport, onOpenExport,
      compareExtra, crossRoots, currentRoot, onAddExtra, onRemoveExtra,
      reportFile, onReport, onReportHtml, onOpenReport, reports, busy,
    }) {
      const experiments = data?.experiments ?? []
      const metrics = data?.metrics ?? []
      const commonFactors = data?.commonFactors ?? []
      const selectedMetric = metrics.find(entry => entry.key === metric) ?? metrics[0] ?? null
      const labels = data?.labels ?? []
      const groupValue = data?.groupBy?.[0] ?? ''
      const crossOptions = (crossRoots ?? []).filter(entry => entry.root !== currentRoot)
      const [copied, setCopied] = React.useState(false)
      const [reportCopied, setReportCopied] = React.useState(false)
      const copyExport = () => {
        if (exportFile == null || typeof navigator === 'undefined' || navigator.clipboard === undefined) return
        void navigator.clipboard.writeText(exportFile.path).then(() => setCopied(true)).catch(() => {})
      }
      const copyReport = () => {
        if (reportFile == null || typeof navigator === 'undefined' || navigator.clipboard === undefined) return
        void navigator.clipboard.writeText(reportFile.path).then(() => setReportCopied(true)).catch(() => {})
      }
      const cellText = (experiment, label) => {
        const bucket = experiment.groups.find(groupEntry => groupEntry.label === label)
        if (bucket === undefined || selectedMetric === null) return '—'
        const stat = bucket.stats?.[selectedMetric.key]
        if (stat === undefined || stat.n === 0) return '—'
        return `${formatNumber(stat.mean)} ± ${formatNumber(stat.sd)} (n=${stat.n})`
      }
      return h('div', { className: 'xpl-body' },
        h('div', { className: 'xpl-main xpl-candidates' },
          h('div', { className: 'xpl-cand-head' },
            h('h3', { className: 'xpl-compare-title' }, t('multiCompareTitle')),
            h('button', { type: 'button', className: 'xpl-link', onClick: onBack }, t('compareBack'))),
          h('p', { className: 'xpl-desc' }, t('compareHint')),
          h('div', { className: 'xpl-form-row' },
            selectedMetric === null ? null : h('label', { className: 'xpl-inline-field' }, t('compareMetric'),
              h('select', {
                className: 'xpl-select xpl-select-sm',
                value: selectedMetric.key,
                onChange: (event) => onMetric(event.target.value),
              }, metrics.map(entry => h('option', { key: entry.key, value: entry.key },
                `${entry.label ?? entry.key}${entry.unit ? ` (${entry.unit})` : ''}`)))),
            commonFactors.length === 0 ? null : h('label', { className: 'xpl-inline-field' }, t('compareGroup'),
              h('select', {
                className: 'xpl-select xpl-select-sm',
                value: groupValue,
                onChange: (event) => onGroup(event.target.value),
              },
              h('option', { value: '' }, t('groupNone')),
              commonFactors.map(key => h('option', { key, value: key }, key)))),
            crossOptions.length === 0 ? null : h('label', { className: 'xpl-inline-field' }, t('addCrossExperiment'),
              h('select', {
                className: 'xpl-select xpl-select-sm',
                value: '',
                onChange: (event) => {
                  const value = event.target.value
                  if (value === '') return
                  const [root, id] = value.split('::')
                  if (root !== undefined && id !== undefined) {
                    const bucket = crossOptions.find(entry => entry.root === root)
                    const experiment = bucket?.experiments.find(entry => entry.id === id)
                    onAddExtra(root, id, experiment?.name ?? id)
                  }
                  event.target.value = ''
                },
              },
              h('option', { value: '' }, '—'),
              crossOptions.flatMap(entry => entry.experiments.map(experiment => h('option', {
                key: `${entry.root}::${experiment.id}`,
                value: `${entry.root}::${experiment.id}`,
              }, `${experiment.name} (${shortPath(entry.root)})`))))),
            compareExtra.map(extra => h('span', { key: `${extra.root}::${extra.id}`, className: 'xpl-baseline-chip' },
              extra.name,
              h('button', {
                type: 'button',
                className: 'xpl-chip-remove',
                title: t('baselineRemove'),
                onClick: () => onRemoveExtra(extra.root, extra.id),
              }, '×'))),
            h('button', { type: 'button', className: 'xpl-link', onClick: onRefresh }, t('refresh')),
            selectedMetric === null || data === null ? null : h('button', {
              type: 'button', className: 'xpl-link', onClick: () => onExport('csv'),
            }, t('exportCsv')),
            selectedMetric === null || data === null ? null : h('button', {
              type: 'button', className: 'xpl-link', onClick: () => onExport('md'),
            }, t('exportMd')),
            exportFile == null ? null : h('button', {
              type: 'button', className: 'xpl-link', onClick: onOpenExport,
            }, t('openExport')),
            data === null ? null : h('button', {
              type: 'button',
              className: 'xpl-link',
              disabled: busy === 'compareReportHtml',
              onClick: onReportHtml,
            }, busy === 'compareReportHtml' ? t('generatingReport') : t('htmlReport')),
            data === null ? null : h('button', {
              type: 'button',
              className: 'xpl-primary',
              disabled: busy === 'compareReport',
              onClick: onReport,
            }, busy === 'compareReport' ? t('generatingReport') : t('compareReport')),
            reportFile == null ? null : h('button', {
              type: 'button', className: 'xpl-link', onClick: onOpenReport,
            }, t('openCompareReport'))),
          exportFile == null ? null : h('div', { className: 'xpl-report' },
            h('span', { className: 'xpl-muted' }, `${t('exportFile')}: `),
            h('code', { className: 'xpl-code' }, exportFile.relative),
            h('button', { type: 'button', className: 'xpl-link', onClick: copyExport }, copied ? t('copied') : t('copyPath'))),
          reportFile == null ? null : h('div', { className: 'xpl-report' },
            h('span', { className: 'xpl-muted' }, `${t('compareReportPath')}: `),
            h('code', { className: 'xpl-code' }, reportFile.relative),
            h('button', { type: 'button', className: 'xpl-link', onClick: copyReport }, reportCopied ? t('copied') : t('copyPath'))),
          (reports ?? []).length === 0 ? null : h('div', { className: 'xpl-field' },
            h('div', { className: 'xpl-field-label' }, t('compareReports')),
            h('ul', { className: 'xpl-artifacts' }, reports.map(report => h('li', { key: report.id },
              h('code', { className: 'xpl-code' }, report.path),
              ' ',
              h('button', {
                type: 'button',
                className: 'xpl-link',
                onClick: () => onOpenReport(report.path),
              }, t('openCompareReport')))))),
          loading
            ? h('div', { className: 'xpl-empty' }, t('loading'))
            : data === null || experiments.length === 0
              ? h('div', { className: 'xpl-empty' }, t('compareNeedTwo'))
              : h('div', { className: 'xpl-table-wrap' },
                h('table', { className: 'xpl-table' },
                  h('thead', null, h('tr', null,
                    h('th', null, t('group')),
                    experiments.map(experiment => h('th', { key: experiment.id },
                      `${experiment.name} (${experiment.runCount})`)))),
                  h('tbody', null, labels.map(label => h('tr', { key: label },
                    h('td', { className: 'xpl-td-strong' }, label),
                    experiments.map(experiment => h('td', { key: experiment.id }, cellText(experiment, label))))))))))
    }

    /**
     * One experiment: header, chips, runs table or one run's detail.
     * @param props - experiment, run selection, report/sweep/baseline state and locale.
     * @returns the detail area.
     */
    function ExperimentView({
      experiment, runId, t, onSelectRun, onBackToRuns,
      busy, onReproduce, report, onReport, onReportHtml,
      onUpdateExperiment, onUpdateRun, onDeleteRun, onClone, onConclude,
      sweepOpen, sweepJob, onToggleSweep, onStartSweep, onRefreshSweep, onStopSweep,
      baselines, baselineOptions, onAddBaseline, onRemoveBaseline, onOpenReport,
      onSavePreset, onDeletePreset,
      onSaveSchedule, onDeleteSchedule, onToggleSchedule, onRunSchedule, onOpenScheduleDetail,
    }) {
      const runs = Array.isArray(experiment.runs) ? [...experiment.runs].reverse() : []
      const run = runId === null ? null : runs.find(entry => entry.id === runId) ?? null
      const factors = Array.isArray(experiment.factors) ? experiment.factors : []
      const metrics = Array.isArray(experiment.metrics) ? experiment.metrics : []
      const metricKeys = metrics.length > 0
        ? metrics.map(metric => metric.key)
        : uniqueKeys(runs.flatMap(entry => Object.keys(entry.metrics ?? {}))).slice(0, 6)

      const [groupChoice, setGroupChoice] = React.useState('__auto__')
      const [chartMetric, setChartMetric] = React.useState('')
      const varying = varyingKeys(runs, factors)
      const groupBy = groupChoice === '__auto__'
        ? varying
        : groupChoice === '__all__'
          ? factors.map(factor => factor.key)
          : groupChoice === '__none__' ? [] : [groupChoice]
      const comparison = compareLocal(experiment, groupBy)
      const numericMetrics = comparison.metrics.filter(metric => comparison.groups.some(group => (group.stats[metric.key]?.n ?? 0) > 0))
      const selectedMetric = numericMetrics.find(metric => metric.key === chartMetric) ?? numericMetrics[0] ?? null
      const runIndex = run === null ? -1 : runs.findIndex(entry => entry.id === run.id)
      const previous = runIndex >= 0 ? runs[runIndex + 1] : undefined
      const primaryBaseline = baselines.length > 0 ? baselines[0] : null
      const [copied, setCopied] = React.useState(false)
      const [editing, setEditing] = React.useState(false)
      const [draftName, setDraftName] = React.useState(experiment.name ?? '')
      const [draftDescription, setDraftDescription] = React.useState(experiment.description ?? '')
      const [draftTags, setDraftTags] = React.useState((experiment.tags ?? []).join(', '))
      const [draftArchived, setDraftArchived] = React.useState(experiment.archived === true)
      React.useEffect(() => {
        setDraftName(experiment.name ?? '')
        setDraftDescription(experiment.description ?? '')
        setDraftTags((experiment.tags ?? []).join(', '))
        setDraftArchived(experiment.archived === true)
      }, [experiment.id])
      const saveMetadata = () => {
        onUpdateExperiment({
          name: draftName,
          description: draftDescription,
          tags: draftTags.split(',').map(tag => tag.trim()).filter(Boolean),
          archived: draftArchived,
        })
        setEditing(false)
      }
      const copyReport = () => {
        const text = report?.path ?? report?.relative ?? ''
        if (text === '' || typeof navigator === 'undefined' || navigator.clipboard === undefined) return
        void navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => {})
      }

      return h('div', { className: 'xpl-detail' },
        h('div', { className: 'xpl-detail-head' },
          h('div', null,
            h('h3', { className: 'xpl-detail-title' }, experiment.name, experiment.archived === true ? ` · ${t('archivedBadge')}` : ''),
            h('div', { className: 'xpl-detail-id' }, experiment.id)),
          h('div', { className: 'xpl-detail-actions' },
            h('button', {
              type: 'button',
              className: 'xpl-link',
              onClick: () => setEditing(!editing),
            }, editing ? t('cancel') : t('edit')),
            h('button', {
              type: 'button',
              className: 'xpl-link',
              onClick: onClone,
            }, t('clone')),
            h('button', {
              type: 'button',
              className: 'xpl-link',
              onClick: () => onConclude('draft'),
            }, t('conclusion')),
            h('button', {
              type: 'button',
              className: 'xpl-link',
              'data-active': sweepOpen ? 'true' : undefined,
              onClick: onToggleSweep,
            }, t('sweep')),
            h('button', {
              type: 'button',
              className: 'xpl-link',
              disabled: busy === 'reportHtml',
              onClick: onReportHtml,
            }, busy === 'reportHtml' ? t('generatingReport') : t('htmlReport')),
            h('button', {
              type: 'button',
              className: 'xpl-primary',
              disabled: busy === 'report',
              onClick: onReport,
            }, busy === 'report' ? t('generatingReport') : t('generateReport')),
            run === null ? null : h('button', {
              type: 'button',
              className: 'xpl-link',
              onClick: onBackToRuns,
            }, t('backToRuns')))),
        editing ? h('div', { className: 'xpl-form' },
          h('label', { className: 'xpl-field' }, t('name'),
            h('input', {
              className: 'xpl-input',
              value: draftName,
              onChange: (event) => setDraftName(event.target.value),
            })),
          h('label', { className: 'xpl-field' }, t('description'),
            h('textarea', {
              className: 'xpl-textarea',
              value: draftDescription,
              onChange: (event) => setDraftDescription(event.target.value),
            })),
          h('label', { className: 'xpl-field' }, t('tags'),
            h('input', {
              className: 'xpl-input',
              value: draftTags,
              placeholder: 'tag-a, tag-b',
              onChange: (event) => setDraftTags(event.target.value),
            })),
          h('label', { className: 'xpl-inline-field' },
            h('input', {
              type: 'checkbox',
              checked: draftArchived,
              onChange: (event) => setDraftArchived(event.target.checked),
            }),
            t('archived')),
          h('div', { className: 'xpl-form-row' },
            h('button', { type: 'button', className: 'xpl-primary', onClick: saveMetadata }, t('save')),
            h('button', { type: 'button', className: 'xpl-link', onClick: () => setEditing(false) }, t('cancel')))) : null,
        report == null ? null : h('div', { className: 'xpl-report' },
          h('span', { className: 'xpl-muted' }, `${t('reportPath')}: `),
          h('code', { className: 'xpl-code' }, report.relative ?? report.path ?? ''),
          h('button', { type: 'button', className: 'xpl-link', onClick: copyReport }, copied ? t('copied') : t('copyPath')),
          h('button', {
            type: 'button',
            className: 'xpl-link',
            disabled: busy === 'openReport',
            onClick: onOpenReport,
          }, busy === 'openReport' ? t('openingReport') : t('openReport'))),
        experiment.description ? h('p', { className: 'xpl-desc' }, experiment.description) : null,
        experiment.conclusion ? h('div', { className: 'xpl-report' },
          h('strong', null, `[${t(experiment.conclusion.status ?? 'draft')}] `),
          h('span', null, experiment.conclusion.text || '—'),
          experiment.conclusion.decidedBy ? h('span', { className: 'xpl-muted' },
            ` · ${experiment.conclusion.decidedBy}${experiment.conclusion.role ? ` (${experiment.conclusion.role})` : ''}`) : null,
          experiment.conclusion.signature?.keyId ? h('span', { className: 'xpl-muted' },
            ` · signed ${experiment.conclusion.signature.keyId.slice(0, 12)}…`) : null,
          h('button', {
            type: 'button', className: 'xpl-link', onClick: () => onConclude('approved'),
          }, t('approved')),
          h('button', {
            type: 'button', className: 'xpl-link', onClick: () => onConclude('rejected'),
          }, t('rejected'))) : null,
        Array.isArray(experiment.tags) && experiment.tags.length > 0 ? h('div', { className: 'xpl-chips' },
          h('span', { className: 'xpl-chip-group' },
            h('span', { className: 'xpl-chip-label' }, t('tags')),
            experiment.tags.map(tag => h('span', { key: tag, className: 'xpl-chip' }, tag)))) : null,
        h('div', { className: 'xpl-chips' },
          factors.length > 0 ? h('span', { className: 'xpl-chip-group' },
            h('span', { className: 'xpl-chip-label' }, t('factors')),
            factors.map(factor => h('span', { key: factor.key, className: 'xpl-chip' },
              factor.label ?? factor.key, factor.unit ? ` (${factor.unit})` : ''))) : null,
          metrics.length > 0 ? h('span', { className: 'xpl-chip-group' },
            h('span', { className: 'xpl-chip-label' }, t('metrics')),
            metrics.map(metric => h('span', { key: metric.key, className: 'xpl-chip' },
              metric.label ?? metric.key,
              metric.unit ? ` (${metric.unit})` : '',
              metric.direction === 'min' ? ' ↓' : metric.direction === 'max' ? ' ↑' : ''))) : null),
        run === null && sweepOpen ? h(SweepPanel, {
          key: 'sweep',
          job: sweepJob,
          t,
          presets: experiment.sweepPresets ?? [],
          onSavePreset,
          onDeletePreset,
          schedules: experiment.schedules ?? [],
          onSaveSchedule,
          onDeleteSchedule,
          onToggleSchedule,
          onRunSchedule,
          onOpenScheduleDetail,
          onStart: onStartSweep,
          onRefresh: onRefreshSweep,
          onStop: onStopSweep,
        }) : null,
        run === null
          ? (runs.length === 0
            ? h('div', { className: 'xpl-empty' }, t('noRuns'))
            : h(React.Fragment, null,
              h(RunsTable, { key: 'runs', runs, factors, metricKeys, t, onSelectRun }),
              h(CompareSection, {
                key: 'compare',
                comparison,
                factors,
                groupChoice,
                onGroup: setGroupChoice,
                numericMetrics,
                selectedMetric,
                onMetric: setChartMetric,
                baselines,
                baselineOptions,
                onAddBaseline,
                onRemoveBaseline,
                t,
              })))
          : h(RunDetail, {
            run,
            previous,
            baseline: primaryBaseline,
            metrics,
            t,
            onReproduce,
            onUpdateRun,
            onDeleteRun,
            busy,
          }))
    }

    /**
     * The comparison block under the runs table: grouping control, summary
     * table and one bar chart with standard-deviation whiskers.
     * @param props - comparison, factors, controls and locale.
     * @returns the section.
     */
    function CompareSection({
      comparison, factors, groupChoice, onGroup, numericMetrics, selectedMetric, onMetric,
      baselines, baselineOptions, onAddBaseline, onRemoveBaseline, t,
    }) {
      const showChart = selectedMetric !== null && numericMetrics.length > 0
      const primaryBaseline = baselines.length > 0 ? baselines[0] : null
      return h('div', { className: 'xpl-compare' },
        h('div', { className: 'xpl-compare-head' },
          h('h4', { className: 'xpl-compare-title' }, t('compare')),
          h('label', { className: 'xpl-inline-field' },
            h('span', null, t('addBaseline')),
            h('select', {
              className: 'xpl-select xpl-select-sm',
              value: '',
              onChange: (event) => {
                const value = event.target.value
                if (value === '') return
                const [experimentId, runId] = value.split('::')
                if (experimentId !== undefined && runId !== undefined) onAddBaseline(experimentId, runId)
                event.target.value = ''
              },
            },
            h('option', { value: '' }, '—'),
            (baselineOptions?.experiments ?? []).flatMap(experiment => experiment.runs.map(run => h('option', {
              key: `${experiment.id}::${run.id}`,
              value: `${experiment.id}::${run.id}`,
            }, `${experiment.name} / ${run.label}`))))),
          baselines.map(baseline => h('span', { key: baseline.id, className: 'xpl-baseline-chip' },
            baseline.name,
            h('button', {
              type: 'button',
              className: 'xpl-chip-remove',
              title: t('baselineRemove'),
              onClick: () => onRemoveBaseline(baseline.id),
            }, '×'))),
          factors.length > 0 ? h('label', { className: 'xpl-inline-field' },
            h('span', null, t('groupBy')),
            h('select', {
              className: 'xpl-select xpl-select-sm',
              value: groupChoice,
              onChange: (event) => onGroup(event.target.value),
            },
            h('option', { value: '__auto__' }, t('groupAuto')),
            h('option', { value: '__none__' }, t('groupNone')),
            factors.map(factor => h('option', { key: factor.key, value: factor.key }, factor.label ?? factor.key)),
            factors.length > 1 ? h('option', { value: '__all__' }, t('groupAll')) : null)) : null,
          showChart ? h('label', { className: 'xpl-inline-field' },
            h('span', null, t('chartMetric')),
            h('select', {
              className: 'xpl-select xpl-select-sm',
              value: selectedMetric.key,
              onChange: (event) => onMetric(event.target.value),
            },
            numericMetrics.map(metric => h('option', { key: metric.key, value: metric.key },
              `${metric.label ?? metric.key}${metric.unit ? ` (${metric.unit})` : ''}`)))) : null),
        comparison.groups.length === 0 ? null : h('div', { className: 'xpl-table-wrap' },
          h('table', { className: 'xpl-table' },
            h('thead', null, h('tr', null,
              h('th', null, t('group')),
              h('th', null, t('runsShort')),
              comparison.metrics.map(metric => h('th', { key: metric.key },
                `${metric.label ?? metric.key}${metric.unit ? ` (${metric.unit})` : ''}`)))),
            h('tbody', null, comparison.groups.map(group => h('tr', { key: group.label },
              h('td', { className: 'xpl-td-strong' }, group.label),
              h('td', null, String(group.runs)),
              comparison.metrics.map(metric => {
                const stat = group.stats[metric.key]
                const baselineValue = primaryBaseline?.metrics?.[metric.key]
                const delta = typeof baselineValue === 'number' && stat !== undefined && stat.n > 0 && typeof stat.mean === 'number'
                  ? ` (Δ ${formatSigned(stat.mean - baselineValue)})`
                  : ''
                return h('td', { key: metric.key }, stat === undefined || stat.n === 0
                  ? '—'
                  : `${formatNumber(stat.mean)} ± ${formatNumber(stat.sd)}${Array.isArray(stat.ci95) ? ` [${formatNumber(stat.ci95[0])}, ${formatNumber(stat.ci95[1])}]` : ''}${delta}`)
              })))))),
        comparison.groups.some(group => comparison.metrics.some(metric => {
          const stat = group.stats[metric.key]
          return stat !== undefined && stat.n > 0 && stat.smallSample
        })) ? h('div', { className: 'xpl-warn' }, t('smallSample')) : null,
        showChart && comparison.groups.length > 0
          ? h(BarChart, { comparison, metric: selectedMetric, t })
          : null,
        numericMetrics.length > 1 ? h('div', { className: 'xpl-mini-grid' },
          h('div', { className: 'xpl-field-label' }, t('smallMultiples')),
          numericMetrics.map(metric => h('div', { key: metric.key, className: 'xpl-mini' },
            h('div', { className: 'xpl-field-label' }, `${metric.label ?? metric.key}${metric.unit ? ` (${metric.unit})` : ''}`),
            h(BarChart, { comparison, metric, t })))) : null)
    }

    /**
     * A single-metric bar chart with ±sd whiskers, drawn as SVG.
     * @param props - comparison, metric and locale.
     * @returns the chart.
     */
    function BarChart({ comparison, metric, t }) {
      const groups = comparison.groups
      const stats = groups.map(group => group.stats[metric.key])
      const max = Math.max(...stats.map(stat => Math.max((stat?.mean ?? 0) + (stat?.sd ?? 0), ...(Array.isArray(stat?.ci95) ? [stat.ci95[1]] : [0]))), 0.000001)
      const W = 600
      const H = 220
      const left = 44
      const right = 16
      const top = 18
      const bottom = 40
      const plotW = W - left - right
      const plotH = H - top - bottom
      const step = plotW / Math.max(groups.length, 1)
      const barW = Math.min(56, step * 0.55)
      const y = (value) => top + plotH - (Math.max(0, value) / max) * plotH
      return h('svg', { className: 'xpl-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t('chartLabel') },
        h('line', { x1: left, y1: top + plotH, x2: W - right, y2: top + plotH, className: 'xpl-chart-axis' }),
        h('text', { x: left - 8, y: top + 4, textAnchor: 'end', className: 'xpl-chart-label' }, formatNumber(max)),
        h('text', { x: left - 8, y: top + plotH, textAnchor: 'end', className: 'xpl-chart-label' }, '0'),
        groups.map((group, index) => {
          const stat = group.stats[metric.key]
          if (stat === undefined || stat.n === 0 || stat.mean === null) return null
          const cx = left + step * index + step / 2
          const barTop = y(stat.mean)
          const high = y(stat.mean + (stat.sd ?? 0))
          const low = y(Math.max(0, stat.mean - (stat.sd ?? 0)))
          const ciHigh = Array.isArray(stat.ci95) ? y(stat.ci95[1]) : null
          const ciLow = Array.isArray(stat.ci95) ? y(Math.max(0, stat.ci95[0])) : null
          return h('g', { key: group.label },
            h('rect', {
              x: cx - barW / 2,
              y: barTop,
              width: barW,
              height: Math.max(1, top + plotH - barTop),
              className: 'xpl-bar',
            }),
            h('line', { x1: cx, y1: high, x2: cx, y2: low, className: 'xpl-whisker' }),
            h('line', { x1: cx - 6, y1: high, x2: cx + 6, y2: high, className: 'xpl-whisker' }),
            h('line', { x1: cx - 6, y1: low, x2: cx + 6, y2: low, className: 'xpl-whisker' }),
            ciHigh === null ? null : h('line', { x1: cx + barW / 2 + 6, y1: ciHigh, x2: cx + barW / 2 + 6, y2: ciLow, className: 'xpl-whisker-ci' }),
            ciHigh === null ? null : h('line', { x1: cx + barW / 2 + 2, y1: ciHigh, x2: cx + barW / 2 + 10, y2: ciHigh, className: 'xpl-whisker-ci' }),
            ciHigh === null ? null : h('line', { x1: cx + barW / 2 + 2, y1: ciLow, x2: cx + barW / 2 + 10, y2: ciLow, className: 'xpl-whisker-ci' }),
            h('text', { x: cx, y: top + plotH + 16, textAnchor: 'middle', className: 'xpl-chart-label' }, shortLabel(group.label)),
            h('text', { x: cx, y: high - 4, textAnchor: 'middle', className: 'xpl-chart-value' }, formatNumber(stat.mean)))
        }))
    }

    /**
     * @param values - array of keys.
     * @returns unique keys in first-seen order.
     */
    function uniqueKeys(values) {
      const keys = []
      for (const value of values) if (!keys.includes(value)) keys.push(value)
      return keys
    }

    /**
     * The run table: one row per run, dynamic metric columns.
     * @param props - runs, factor declarations, metric keys, callbacks.
     * @returns the table.
     */
    function RunsTable({ runs, factors, metricKeys, t, onSelectRun }) {
      const params = factors.map(factor => factor.key).slice(0, 4)
      return h('div', { className: 'xpl-table-wrap' },
        h('table', { className: 'xpl-table' },
          h('thead', null, h('tr', null,
            h('th', null, t('label')),
            h('th', null, t('status')),
            h('th', null, t('duration')),
            params.map(key => h('th', { key: `p-${key}` }, key)),
            metricKeys.slice(0, 6).map(key => h('th', { key: `m-${key}` }, key)))),
          h('tbody', null, runs.map(run => h('tr', {
            key: run.id,
            className: 'xpl-tr',
            onClick: () => onSelectRun(run.id),
          },
          h('td', { className: 'xpl-td-strong' }, run.label || run.id),
          h('td', null, h('span', { className: 'xpl-status', 'data-status': run.status }, statusText(run.status, t))),
          h('td', null, formatDuration(run.durationMs)),
          params.map(key => h('td', { key: `p-${key}` }, run.params?.[key] === undefined ? '—' : formatValue(run.params[key]))),
          metricKeys.slice(0, 6).map(key => h('td', { key: `m-${key}` }, run.metrics?.[key] === undefined ? '—' : formatValue(run.metrics[key]))))))))
    }

    /**
     * One run in detail.
     * @param props - run, declared metrics, locale.
     * @returns the detail card.
     */
    function RunDetail({ run, previous, baseline, metrics, t, onReproduce, onUpdateRun, onDeleteRun, busy }) {
      const [notesDraft, setNotesDraft] = React.useState(run.notes ?? '')
      React.useEffect(() => {
        setNotesDraft(run.notes ?? '')
      }, [run.id])
      const params = Object.entries(run.params ?? {})
      const values = Object.entries(run.metrics ?? {})
      const unitOf = (key) => {
        const declared = metrics.find(metric => metric.key === key)
        return declared?.unit ? ` (${declared.unit})` : ''
      }
      const changedParams = previous === undefined ? [] : diffEntries(previous.params, run.params)
      const changedMetrics = previous === undefined ? [] : diffEntries(previous.metrics, run.metrics)
      const changedArtifacts = previous === undefined ? [] : diffArtifactsLocal(previous.artifacts, run.artifacts)
      const hasDiff = changedParams.length + changedMetrics.length + changedArtifacts.length > 0
      const canReproduce = Boolean(run.command || run.manifest?.command)
      return h('div', { className: 'xpl-run' },
        h('div', { className: 'xpl-run-head' },
          h('span', { className: 'xpl-status', 'data-status': run.status }, statusText(run.status, t)),
          h('span', { className: 'xpl-muted' }, `${formatTime(run.startedAt)} · ${formatDuration(run.durationMs)}`),
          typeof run.exitCode === 'number' ? h('span', { className: 'xpl-muted' }, `exit ${run.exitCode}`) : null,
          h('button', {
            type: 'button',
            className: 'xpl-link',
            disabled: busy === 'reproduce' || !canReproduce,
            title: canReproduce ? undefined : t('noCommand'),
            onClick: onReproduce,
          }, busy === 'reproduce' ? t('reproducing') : t('reproduce'))),
        run.command ? h('div', { className: 'xpl-field' },
          h('span', { className: 'xpl-field-label' }, t('command')),
          h('code', { className: 'xpl-code' }, run.command)) : null,
        run.manifest ? h('div', { className: 'xpl-field' },
          h('div', { className: 'xpl-field-label' }, t('manifest')),
          h('dl', { className: 'xpl-kv' },
            run.manifest.git ? h(React.Fragment, null,
              h('dt', null, t('git')),
              h('dd', null, `${run.manifest.git.commit?.slice(0, 12) ?? '—'}${run.manifest.git.branch ? ` (${run.manifest.git.branch})` : ''}${run.manifest.git.dirty ? ' · dirty' : ''}`)) : null,
            h('dt', null, t('toolchain')),
            h('dd', null, `node ${run.manifest.toolchain?.node ?? '—'} · ${run.manifest.toolchain?.platform ?? ''}/${run.manifest.toolchain?.arch ?? ''}`),
            Object.entries(run.manifest.env ?? {}).length === 0 ? null : h(React.Fragment, null,
              h('dt', null, t('env')),
              h('dd', null, Object.entries(run.manifest.env).map(([key, value]) => `${key}=${value}`).join(', '))))) : null,
        h('div', { className: 'xpl-grid' },
          h('div', null,
            h('div', { className: 'xpl-field-label' }, t('params')),
            params.length === 0 ? h('div', { className: 'xpl-muted' }, '—')
              : h('dl', { className: 'xpl-kv' }, params.map(([key, value]) => h(React.Fragment, { key },
                h('dt', null, key), h('dd', null, formatValue(value)))))),
          h('div', null,
            h('div', { className: 'xpl-field-label' }, t('metrics')),
            values.length === 0 ? h('div', { className: 'xpl-muted' }, '—')
              : h('dl', { className: 'xpl-kv' }, values.map(([key, value]) => h(React.Fragment, { key },
                h('dt', null, `${key}${unitOf(key)}`), h('dd', null, formatValue(value))))))),
        h('div', { className: 'xpl-field' },
          h('div', { className: 'xpl-field-label' }, t('artifacts')),
          Array.isArray(run.artifacts) && run.artifacts.length > 0
            ? h('ul', { className: 'xpl-artifacts' }, run.artifacts.map((artifact, index) => h('li', { key: `${artifact.path}-${index}` },
              h('code', { className: 'xpl-code' }, artifact.path),
              artifact.missing ? h('span', { className: 'xpl-warn' }, ' missing')
                : h('span', { className: 'xpl-muted' }, ` · ${artifact.sha256?.slice(0, 12) ?? ''} · ${formatBytes(artifact.bytes)}`))))
            : h('div', { className: 'xpl-muted' }, t('noArtifacts'))),
        Array.isArray(run.datasets) && run.datasets.length > 0 ? h('div', { className: 'xpl-field' },
          h('div', { className: 'xpl-field-label' }, t('datasets')),
          h('ul', { className: 'xpl-artifacts' }, run.datasets.map((dataset, index) => h('li', { key: `${dataset.path}-${index}` },
            h('code', { className: 'xpl-code' }, dataset.path),
            h('span', { className: 'xpl-muted' }, ` · ${dataset.kind ?? ''}${typeof dataset.rows === 'number' ? ` · ${dataset.rows}×${dataset.cols}` : ''} · ${dataset.sha256?.slice(0, 12) ?? ''}`))))) : null,
        previous === undefined ? null : h('div', { className: 'xpl-field' },
          h('div', { className: 'xpl-field-label' }, `${t('diffVsPrevious')} · ${previous.label ?? previous.id}`),
          hasDiff
            ? h('div', { className: 'xpl-diff' },
              changedParams.map(row => h('div', { key: `p-${row.key}`, className: 'xpl-diff-row' },
                h('code', null, row.key), ` ${row.before === undefined ? '—' : formatValue(row.before)} → ${row.after === undefined ? '—' : formatValue(row.after)}`)),
              changedMetrics.map(row => h('div', { key: `m-${row.key}`, className: 'xpl-diff-row' },
                h('code', null, row.key), ` ${row.before === undefined ? '—' : formatValue(row.before)} → ${row.after === undefined ? '—' : formatValue(row.after)}`)),
              changedArtifacts.map(row => h('div', { key: `a-${row.path}`, className: 'xpl-diff-row' },
                h('span', { className: 'xpl-warn' }, row.state === 'added' ? t('diffAdded') : row.state === 'removed' ? t('diffRemoved') : t('diffChanged')),
                ' ',
                h('code', null, row.path))))
            : h('div', { className: 'xpl-muted' }, t('noChanges'))),
        baseline === null || baseline === undefined ? null : h('div', { className: 'xpl-field' },
          h('div', { className: 'xpl-field-label' }, `${t('vsBaseline')} · ${baseline.experimentName} / ${baseline.label}`),
          (() => {
            const rows = diffEntries(baseline.metrics ?? {}, run.metrics ?? {})
            return rows.length === 0
              ? h('div', { className: 'xpl-muted' }, t('noChanges'))
              : h('div', { className: 'xpl-diff' }, rows.map(row => h('div', { key: `b-${row.key}`, className: 'xpl-diff-row' },
                h('code', null, row.key),
                ` ${row.before === undefined ? '—' : formatValue(row.before)} → ${row.after === undefined ? '—' : formatValue(row.after)}`)))
          })()),
        h('div', { className: 'xpl-field' },
          h('div', { className: 'xpl-field-label' }, t('notes')),
          h('textarea', {
            className: 'xpl-textarea',
            value: notesDraft,
            onChange: (event) => setNotesDraft(event.target.value),
          }),
          h('div', { className: 'xpl-form-row' },
            h('button', { type: 'button', className: 'xpl-link', onClick: () => onUpdateRun(run.id, notesDraft) }, t('save')),
            h('button', {
              type: 'button',
              className: 'xpl-link',
              onClick: () => onDeleteRun(run.id),
            }, t('deleteRun')))),
        run.stdoutTail ? h('div', { className: 'xpl-field' },
          h('div', { className: 'xpl-field-label' }, t('stdout')),
          h('pre', { className: 'xpl-pre' }, run.stdoutTail)) : null,
        run.stderrTail ? h('div', { className: 'xpl-field' },
          h('div', { className: 'xpl-field-label' }, t('stderr')),
          h('pre', { className: 'xpl-pre' }, run.stderrTail)) : null)
    }

    /**
     * @param bytes - byte count.
     * @returns a human size.
     */
    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '—'
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }

    /** Panel styles: theme tokens only, so light and dark both inherit the host look. */
    function Styles() {
      return h('style', null, `
.xpl-foot{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;height:32px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:1;text-align:left;cursor:pointer}
.xpl-foot:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.xpl-foot:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.xpl-foot[data-rail="true"]{width:32px;padding:0;justify-content:center}
.xpl-foot-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xpl-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:var(--dsh-frame-overlay-top,24px) 24px 24px}
.xpl-mask{position:absolute;inset:var(--dsh-frame-chrome-top,0px) 0 0;background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur)}
.xpl-panel{position:relative;z-index:1;display:flex;flex-direction:column;box-sizing:border-box;width:min(1040px,100%);height:min(82vh,860px);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-soft);overflow:hidden;font-size:13px}
.xpl-overlay-sidebar{justify-content:flex-end;align-items:stretch;padding:0;pointer-events:none;background:transparent}
.xpl-panel-sidebar{top:var(--dsh-frame-overlay-top,0px);bottom:0;width:clamp(320px,36vw,380px);height:auto;max-height:none;border-radius:0;border-top:0;border-bottom:0;box-shadow:-16px 0 40px rgba(0,0,0,.18);pointer-events:auto}.xpl-panel-sidebar .xpl-head{flex-wrap:wrap}
.xpl-panel-sidebar .xpl-body{flex-direction:column}
.xpl-panel-sidebar .xpl-side{width:auto;max-height:32vh;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.xpl-panel-sidebar .xpl-main{padding:10px 12px}
.xpl-dialog-mask{position:absolute;inset:0;z-index:8;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--dsw-alias-bg-mask-1)}
.xpl-dialog{display:flex;flex-direction:column;gap:10px;width:min(560px,100%);max-height:82%;overflow:auto;box-sizing:border-box;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-overlay);box-shadow:var(--dsw-elevation-soft)}
.xpl-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.xpl-dialog-head h3{margin:0;font-size:14px}
.xpl-dialog-hint{font-size:12px}
.xpl-dialog-dir{display:flex;flex-direction:column;gap:6px;min-height:0}
.xpl-dir-list{display:flex;flex-direction:column;max-height:260px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md)}
.xpl-dir-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}
.xpl-dir-row:last-child{border-bottom:0}
.xpl-dir-row:hover{background:var(--dsw-alias-bg-l1)}
.xpl-badge{padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-l2);color:var(--dsw-alias-label-secondary);font-size:11px}
.xpl-dropzone{display:flex;flex-direction:column;align-items:center;gap:8px;padding:22px 14px;border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);text-align:center;cursor:pointer}
.xpl-dropzone:hover{background:var(--dsw-alias-bg-l1)}
.xpl-drop-title{font-weight:600}
.xpl-ok{color:var(--dsw-alias-label-primary);font-size:12px}
@media (max-width:760px){.xpl-panel-sidebar{width:100vw}}
.xpl-panel:focus{outline:none}
.xpl-head{display:flex;align-items:center;gap:8px;padding:14px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.xpl-title{margin:0;font-size:15px;font-weight:600}
.xpl-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:18px;padding:0 6px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px}
.xpl-select{max-width:280px;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
.xpl-icon-button{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;margin-left:auto;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.xpl-icon-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.xpl-link{border:0;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;cursor:pointer;padding:2px 4px;border-radius:4px}
.xpl-link:hover{background:var(--dsw-alias-interactive-bg-hover)}
.xpl-link:disabled{color:var(--dsw-alias-state-idle-primary);cursor:default;background:transparent}
.xpl-body{display:flex;flex:1;min-height:0}
.xpl-side{flex:none;width:290px;margin:0;padding:8px;list-style:none;overflow:auto;border-right:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;gap:2px}
.xpl-row{display:flex;flex-direction:column;gap:3px;width:100%;padding:8px 10px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.xpl-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.xpl-row[data-selected="true"]{background:var(--dsw-alias-bg-layer-2);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}
.xpl-row-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.xpl-row-meta,.xpl-row-id{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:11px}
.xpl-row-id{font-family:var(--dsw-font-mono,monospace);opacity:.75}
.xpl-main{flex:1;min-width:0;overflow:auto;padding:14px 16px}
.xpl-empty{padding:32px 16px;text-align:center;color:var(--dsw-alias-label-secondary)}
.xpl-alert{margin:6px 8px;padding:8px 10px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;color:var(--dsw-alias-state-error-primary);word-break:break-word}
.xpl-detail{display:flex;flex-direction:column;gap:10px}
.xpl-detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.xpl-detail-title{margin:0;font-size:16px;font-weight:600}
.xpl-detail-id{color:var(--dsw-alias-label-secondary);font-size:11px;font-family:var(--dsw-font-mono,monospace)}
.xpl-desc{margin:0;color:var(--dsw-alias-label-secondary);line-height:1.5}
.xpl-chips{display:flex;flex-wrap:wrap;gap:14px}
.xpl-chip-group{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
.xpl-chip-label{color:var(--dsw-alias-label-secondary);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.xpl-chip{padding:1px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-1);font-size:11px;white-space:nowrap}
.xpl-table-wrap{overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px}
.xpl-table{width:100%;border-collapse:collapse;font-size:12px}
.xpl-table th{position:sticky;top:0;z-index:1;padding:7px 10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-weight:500;text-align:left;white-space:nowrap;border-bottom:1px solid var(--dsw-alias-border-l1)}
.xpl-table td{padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}
.xpl-tr{cursor:pointer}
.xpl-tr:hover{background:var(--dsw-alias-interactive-bg-hover)}
.xpl-td-strong{font-weight:500}
.xpl-status{display:inline-flex;align-items:center;padding:0 7px;height:18px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap}
.xpl-status[data-status="ok"]{color:var(--dsw-alias-state-success-primary)}
.xpl-status[data-status="failed"],.xpl-status[data-status="error"]{color:var(--dsw-alias-state-error-primary)}
.xpl-status[data-status="timeout"]{color:var(--dsw-alias-state-warn-primary)}
.xpl-run{display:flex;flex-direction:column;gap:10px}
.xpl-run-head{display:flex;align-items:center;gap:10px}
.xpl-muted{color:var(--dsw-alias-label-secondary);font-size:12px}
.xpl-field{display:flex;flex-direction:column;gap:4px}
.xpl-field-label{color:var(--dsw-alias-label-secondary);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.xpl-code{font-family:var(--dsw-font-mono,monospace);font-size:11px;word-break:break-all}
.xpl-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.xpl-kv{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:0;font-size:12px}
.xpl-kv dt{color:var(--dsw-alias-label-secondary)}
.xpl-kv dd{margin:0;font-variant-numeric:tabular-nums}
.xpl-artifacts{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:3px;font-size:12px}
.xpl-warn{color:var(--dsw-alias-state-warn-primary)}
.xpl-pre{margin:0;padding:8px 10px;max-height:180px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);font-family:var(--dsw-font-mono,monospace);font-size:11px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
.xpl-footbar{display:flex;align-items:center;padding:8px 16px 12px;border-top:1px solid var(--dsw-alias-border-l1)}
.xpl-compare{display:flex;flex-direction:column;gap:8px;margin-top:6px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1)}
.xpl-compare-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.xpl-compare-title{margin:0;font-size:13px;font-weight:600}
.xpl-inline-field{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:11px}
.xpl-select-sm{height:26px;font-size:12px;max-width:180px}
.xpl-chart{width:100%;max-width:660px;height:auto;margin-top:4px}
.xpl-whisker-ci{stroke:var(--dsw-alias-brand-primary);stroke-width:1.5;stroke-dasharray:3 2}
.xpl-mini-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-top:12px}
.xpl-mini{min-width:0}
.xpl-bar{fill:var(--dsw-alias-brand-primary);opacity:.85}
.xpl-whisker{stroke:var(--dsw-alias-label-secondary);stroke-width:1}
.xpl-chart-axis{stroke:var(--dsw-alias-border-l2);stroke-width:1}
.xpl-chart-label{fill:var(--dsw-alias-label-secondary);font-size:10px}
.xpl-chart-value{fill:var(--dsw-alias-label-primary);font-size:10px}
.xpl-diff{display:flex;flex-direction:column;gap:2px;font-size:12px}
.xpl-diff-row{display:flex;gap:6px;align-items:baseline;white-space:pre-wrap;word-break:break-word}
.xpl-notice{padding:7px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12px;word-break:break-word}
.xpl-detail-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.xpl-primary{display:inline-flex;align-items:center;height:26px;padding:0 10px;border:1px solid var(--dsw-alias-brand-primary);border-radius:6px;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;cursor:pointer}
.xpl-primary:hover{background:var(--dsw-alias-interactive-bg-hover)}
.xpl-primary:disabled{opacity:.6;cursor:default}
.xpl-report{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px}
.xpl-candidates{display:flex;flex-direction:column;gap:10px}
.xpl-cand-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.xpl-sweep{display:flex;flex-direction:column;gap:10px}
.xpl-form{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px}
.xpl-form-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.xpl-field-label-sm{font-size:11px;color:var(--dsw-alias-label-secondary)}
.xpl-input,.xpl-textarea{box-sizing:border-box;width:100%;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
.xpl-textarea{min-height:64px;resize:vertical;font-family:var(--dsw-font-mono,monospace)}
.xpl-progress{height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.xpl-progress > span{display:block;height:100%;background:var(--dsw-alias-brand-primary)}
.xpl-warn{color:var(--dsw-alias-state-warn-primary);font-size:12px}
.xpl-row-wrap{display:flex;align-items:center;gap:2px;padding-left:4px}
.xpl-row-wrap > .xpl-row{flex:1;min-width:0}
.xpl-row-delete{flex:none;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:15px;line-height:1;cursor:pointer;opacity:.55}
.xpl-row-delete:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);opacity:1}
.xpl-row-confirm{display:flex;align-items:center;gap:4px;flex:none;font-size:11px;white-space:nowrap}
.xpl-danger{color:#d9534f}
.xpl-check{flex:none;accent-color:var(--dsw-alias-brand-primary)}
.xpl-baseline-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-1);font-size:11px;white-space:nowrap}
.xpl-chip-remove{border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;padding:0 2px}
.xpl-chip-remove:hover{color:var(--dsw-alias-state-error-primary)}
.xpl-preset-name{max-width:160px}
.xpl-schedule-list{display:flex;flex-direction:column;gap:4px;font-size:12px}
.xpl-notification-list{display:flex;flex-direction:column;gap:10px;padding:12px 16px;overflow:auto}
.xpl-search-list{display:flex;flex-direction:column;gap:4px;padding:8px 16px;overflow:auto}
.xpl-search-input{flex:1;min-width:180px}
.xpl-notice-bar{display:flex;align-items:center;gap:8px;padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);font-size:12px}
.xpl-notice-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xpl-notice-link{border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;padding:0}
.xpl-dots{display:inline-flex;gap:2px}
.xpl-trend{display:inline-flex;align-items:center;gap:4px}
.xpl-spark{display:block}
.xpl-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.xpl-dot-ok{background:var(--dsw-alias-state-success-primary)}
.xpl-dot-bad{background:var(--dsw-alias-state-error-primary)}
`)
    }

    /**
     * The sidebar action's glyph: a flask with a readout line.
     * @param props - size in pixels.
     * @returns the svg element.
     */
    function IconFlask({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, focusable: false,
      },
      h('path', { d: 'M6.2 1.8h3.6M6.8 1.8v3.3L3.4 11.6c-.6 1 .1 2.2 1.3 2.2h6.6c1.2 0 1.9-1.2 1.3-2.2L9.2 5.1V1.8' }),
      h('path', { d: 'M5.1 9.6h5.8' }),
      h('path', { d: 'M6.4 12.2h1.2M8.8 12.2h1.2' }))
    }

    /**
     * @param props - size in pixels.
     * @returns the close glyph.
     */
    function IconClose({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round',
        'aria-hidden': true, focusable: false,
      }, h('path', { d: 'M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8' }))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'experiment-ledger: dictionaries')
        const t = ctx.locale.bind(NS)
        const store = createStore(INITIAL)
        const setState = (patch) => { store.set(Object.assign({}, store.getSnapshot(), patch)) }

        const loadList = async (root) => {
          setState({ loading: true, error: null })
          try {
            const query = typeof root === 'string' && root !== '' ? `?root=${encodeURIComponent(root)}` : ''
            const payload = await request(`/list${query}`)
            const experiments = Array.isArray(payload.experiments) ? payload.experiments : []
            const current = store.getSnapshot()
            const selectedId = current.selectedId !== null && experiments.some(entry => entry.id === current.selectedId)
              ? current.selectedId
              : null
            setState({
              loading: false,
              roots: Array.isArray(payload.roots) ? payload.roots : [],
              root: payload.root ?? null,
              experiments,
              selectedId: selectedId ?? null,
              detail: selectedId === null ? null : current.detail,
              runId: selectedId === null ? null : current.runId,
              compareIds: current.compareIds.filter((entry) => experiments.some((experiment) => experiment.id === entry)),
            })
          } catch (error) {
            const text = error !== null && error !== undefined && error.network === true
              ? t('networkFailed')
              : t('listFailed', { reason: messageOf(error) })
            setState({ loading: false, error: text })
          }
        }

        const loadExperiment = async (root, id) => {
          setState({ detailLoading: true, error: null, selectedId: id, runId: null, report: null })
          try {
            const payload = await request(`/experiment?root=${encodeURIComponent(root)}&id=${encodeURIComponent(id)}`)
            setState({ detailLoading: false, detail: payload.experiment })
            void loadBaselineOptions()
          } catch (error) {
            const text = error !== null && error !== undefined && error.network === true
              ? t('networkFailed')
              : t('detailFailed', { reason: messageOf(error) })
            setState({ detailLoading: false, error: text, detail: null })
          }
        }

        const open = () => {
          let sidebar = false
          let reviewerName = ''
          let reviewerRole = 'reviewer'
          try {
            sidebar = window.localStorage.getItem('experiment-ledger:sidebar') === '1'
            reviewerName = window.localStorage.getItem('experiment-ledger:reviewer') ?? ''
            reviewerRole = window.localStorage.getItem('experiment-ledger:role') ?? 'reviewer'
          } catch {
            // ignore storage failures
          }
          setState({ open: true, sidebar, reviewerName, reviewerRole, error: null, notice: null })
          void loadList(store.getSnapshot().root)
        }
        const close = () => setState({ open: false, error: null, notice: null })
        const toggleSidebar = () => {
          const sidebar = !store.getSnapshot().sidebar
          setState({ sidebar })
          try {
            window.localStorage.setItem('experiment-ledger:sidebar', sidebar ? '1' : '0')
          } catch {
            // ignore storage failures
          }
        }
        const refresh = () => {
          const state = store.getSnapshot()
          void loadList(state.root)
          if (state.selectedId !== null && state.root !== null) void loadExperiment(state.root, state.selectedId)
        }
        const chooseRoot = (root) => {
          setState({ root, selectedId: null, detail: null, runId: null, report: null, candidatesOpen: false, sweepOpen: false, sweepJob: null, baselineOptions: null, compareIds: [], compareOpen: false, multiCompare: null })
          void loadList(root)
        }
        const openRootPicker = async () => {
          const state = store.getSnapshot()
          setState({ rootOpen: true, rootPath: state.root ?? '', browseError: null })
          await browseRoots(state.root ?? '')
        }
        const closeRootPicker = () => setState({ rootOpen: false, browseError: null })
        const setRootPath = (value) => setState({ rootPath: value })
        const browseRoots = async (dir) => {
          setState({ browseLoading: true, browseError: null })
          try {
            const payload = await request(`/browse${typeof dir === 'string' && dir !== '' ? `?dir=${encodeURIComponent(dir)}` : ''}`)
            const current = store.getSnapshot()
            setState({
              browseLoading: false,
              browse: payload,
              rootPath: current.rootPath.trim() === '' ? payload.dir : current.rootPath,
            })
          } catch (error) {
            setState({ browseLoading: false, browseError: messageOf(error) })
          }
        }
        const openRootPath = async (path, create) => {
          if (typeof path !== 'string' || path.trim() === '') return
          setState({ rootBusy: true, browseError: null })
          try {
            const payload = await request('/roots', { method: 'POST', body: { path: path.trim(), create: create === true } })
            setState({ rootBusy: false, rootOpen: false, roots: payload.roots, root: payload.root, selectedId: null, detail: null, runId: null })
            await loadList(payload.root)
          } catch (error) {
            setState({ rootBusy: false, browseError: messageOf(error) })
          }
        }
        const openRootFolder = (create) => {
          const state = store.getSnapshot()
          const path = state.rootPath.trim() !== '' ? state.rootPath.trim() : state.browse?.dir
          return openRootPath(path, create)
        }
        const openImport = () => setState({ importOpen: true, importError: null, importResult: null, importFileName: null })
        const closeImport = () => setState({ importOpen: false, importBusy: false, importError: null, importResult: null })
        const importFile = async (file) => {
          const state = store.getSnapshot()
          if (file === undefined || file === null || state.root === null) return
          if (file.size > 20 * 1024 * 1024) {
            setState({ importError: t('importFailed', { reason: 'file is larger than 20 MB' }) })
            return
          }
          setState({ importBusy: true, importError: null, importFileName: file.name })
          try {
            const data = await fileToBase64(file)
            const payload = await request('/import', {
              method: 'POST',
              body: { root: state.root, data, filename: file.name },
            })
            const summary = payload.summary
            setState({
              importBusy: false,
              importResult: t('importSuccess', {
                summary: `experiments +${summary.experimentsAdded}, runs +${summary.runsAdded}, datasets +${summary.datasetsAdded}`,
              }),
              notice: t('importReady', {
                summary: `experiments +${summary.experimentsAdded}, runs +${summary.runsAdded}, datasets +${summary.datasetsAdded}`,
              }),
            })
            await loadList(state.root)
            if (state.selectedId !== null) await loadExperiment(state.root, state.selectedId)
          } catch (error) {
            setState({ importBusy: false, importError: t('importFailed', { reason: messageOf(error) }) })
          }
        }
        let lastPanelRequestAt = 0
        const pollPanelRequest = async () => {
          try {
            const payload = await request('/panel-request')
            const panelRequest = payload.request
            if (panelRequest === null || typeof panelRequest.at !== 'number' || panelRequest.at <= lastPanelRequestAt) return
            lastPanelRequestAt = panelRequest.at
            const sidebar = panelRequest.mode === 'sidebar'
            try {
              window.localStorage.setItem('experiment-ledger:sidebar', sidebar ? '1' : '0')
            } catch {
              // ignore storage failures
            }
            setState({
              open: true,
              sidebar,
              selectedId: null,
              detail: null,
              runId: null,
            })
            if (typeof panelRequest.root === 'string') {
              setState({ root: panelRequest.root })
              await loadList(panelRequest.root)
              if (typeof panelRequest.experimentId === 'string') await loadExperiment(panelRequest.root, panelRequest.experimentId)
            } else {
              await loadList(store.getSnapshot().root)
            }
          } catch {
            // the route may not be ready yet
          }
        }
        const chooseExperiment = (id) => {
          const state = store.getSnapshot()
          if (state.root === null) return
          setState({ sweepOpen: false, sweepJob: null })
          void loadExperiment(state.root, id)
        }
        const chooseRun = (id) => setState({ runId: id })
        const backToRuns = () => setState({ runId: null })

        const loadCandidates = async () => {
          setState({ candidateLoading: true })
          try {
            const payload = await request('/candidates')
            setState({ candidateLoading: false, candidates: Array.isArray(payload.candidates) ? payload.candidates : [] })
          } catch (error) {
            setState({ candidateLoading: false, notice: t('candidatesFailed', { reason: messageOf(error) }) })
          }
        }
        const openCandidates = () => {
          setState({ candidatesOpen: true, compareOpen: false, notice: null })
          void loadCandidates()
        }
        const closeCandidates = () => setState({ candidatesOpen: false })

        const loadReviews = async () => {
          const state = store.getSnapshot()
          if (state.root === null) return
          setState({ reviewLoading: true })
          try {
            const payload = await request(`/reviews?root=${encodeURIComponent(state.root)}&status=draft`)
            setState({ reviewLoading: false, reviews: payload.reviews ?? [] })
          } catch (error) {
            setState({ reviewLoading: false, reviews: [], notice: t('updateFailed', { reason: messageOf(error) }) })
          }
        }

        const openReviews = () => {
          setState({ reviewOpen: true, candidatesOpen: false, compareOpen: false, notice: null })
          void loadReviews()
        }

        const closeReviews = () => setState({ reviewOpen: false })

        const reviewExperiments = async (ids, status) => {
          const state = store.getSnapshot()
          if (state.root === null || ids.length === 0) return
          try {
            await request('/review', {
              method: 'POST',
              body: {
                root: state.root,
                experimentIds: ids,
                status,
                decidedBy: state.reviewerName.trim() === '' ? undefined : state.reviewerName.trim(),
                role: state.reviewerRole.trim() === '' ? undefined : state.reviewerRole.trim(),
              },
            })
            setState({ notice: t(status === 'approved' ? 'reviewApproved' : 'reviewRejected', { count: ids.length }) })
            await loadList(state.root)
            if (state.selectedId !== null) await loadExperiment(state.root, state.selectedId)
            await loadReviews()
          } catch (error) {
            setState({ notice: t('updateFailed', { reason: messageOf(error) }) })
          }
        }

        const approveAllReviews = () => {
          const state = store.getSnapshot()
          const ids = (state.reviews ?? []).map((review) => review.id)
          void reviewExperiments(ids, 'approved')
        }

        const promote = async (candidateId, values = {}) => {
          const state = store.getSnapshot()
          if (state.root === null || state.selectedId === null) {
            setState({ notice: t('promoteNeedsExperiment') })
            return
          }
          setState({ busy: candidateId, notice: null })
          try {
            const payload = await request('/promote', {
              method: 'POST',
              body: { root: state.root, candidateId, experimentId: state.selectedId, ...values },
            })
            setState({ busy: null, notice: t('promoted', { id: payload.run.id }) })
            await loadCandidates()
            await loadList(state.root)
            await loadExperiment(state.root, state.selectedId)
          } catch (error) {
            setState({ busy: null, notice: t('promoteFailed', { reason: messageOf(error) }) })
          }
        }

        const generateReport = async (format = 'markdown') => {
          const state = store.getSnapshot()
          if (state.root === null || state.selectedId === null) return
          setState({ busy: format === 'html' ? 'reportHtml' : 'report', notice: null })
          try {
            const payload = await request('/report', {
              method: 'POST',
              body: { root: state.root, experimentId: state.selectedId, format },
            })
            setState({ busy: null, report: payload.report, notice: t('reportReady') })
            await loadList(state.root)
          } catch (error) {
            setState({ busy: null, notice: t('reportFailed', { reason: messageOf(error) }) })
          }
        }

        const toggleSweep = () => setState({ sweepOpen: !store.getSnapshot().sweepOpen })

        const openReport = async () => {
          const state = store.getSnapshot()
          if (state.root === null || state.selectedId === null) return
          setState({ busy: 'openReport', notice: null })
          try {
            await request('/report/open', {
              method: 'POST',
              body: { root: state.root, experimentId: state.selectedId },
            })
            setState({ busy: null, notice: t('openedReport') })
          } catch (error) {
            setState({ busy: null, notice: t('openFailed', { reason: messageOf(error) }) })
          }
        }

        const loadBaselineOptions = async () => {
          const state = store.getSnapshot()
          if (state.root === null) return
          try {
            const payload = await request(`/baseline/options?root=${encodeURIComponent(state.root)}`)
            setState({ baselineOptions: payload })
          } catch {
            setState({ baselineOptions: { experiments: [] } })
          }
        }

        const addBaseline = async (baselineExperimentId, baselineRunId) => {
          const state = store.getSnapshot()
          if (state.root === null || state.selectedId === null) return
          try {
            await request('/baseline', {
              method: 'POST',
              body: { root: state.root, experimentId: state.selectedId, baselineExperimentId, baselineRunId },
            })
            await loadExperiment(state.root, state.selectedId)
            setState({ notice: t('baselineSet') })
          } catch (error) {
            setState({ notice: t('baselineFailed', { reason: messageOf(error) }) })
          }
        }

        const removeBaseline = async (baselineId) => {
          const state = store.getSnapshot()
          if (state.root === null || state.selectedId === null) return
          try {
            await request('/baseline', {
              method: 'POST',
              body: { root: state.root, experimentId: state.selectedId, clear: true, baselineId },
            })
            await loadExperiment(state.root, state.selectedId)
            setState({ notice: t('baselineSet') })
          } catch (error) {
            setState({ notice: t('baselineFailed', { reason: messageOf(error) }) })
          }
        }

        const compareRefsOf = (state) => {
          const refs = []
          if (state.root !== null) {
            for (const id of state.compareIds) refs.push({ root: state.root, id })
          }
          for (const extra of state.compareExtra) refs.push({ root: extra.root, id: extra.id })
          return refs
        }

        const loadCrossExperiments = async () => {
          try {
            const payload = await request('/all-experiments')
            setState({ crossRoots: Array.isArray(payload.roots) ? payload.roots : [] })
          } catch (error) {
            setState({ crossRoots: [], notice: t('compareFailed', { reason: messageOf(error) }) })
          }
        }

        const loadMultiCompare = async () => {
          const state = store.getSnapshot()
          const refs = compareRefsOf(state)
          if (refs.length < 2) {
            setState({ multiCompare: null, multiCompareLoading: false })
            return
          }
          setState({ multiCompareLoading: true })
          try {
            const payload = await request('/compare', {
              method: 'POST',
              body: { refs, groupBy: state.multiGroup === '' ? [] : [state.multiGroup] },
            })
            const multiMetric = payload.metrics.some((metric) => metric.key === state.multiMetric)
              ? state.multiMetric
              : payload.metrics[0]?.key ?? ''
            setState({ multiCompareLoading: false, multiCompare: payload, multiMetric })
          } catch (error) {
            setState({ multiCompareLoading: false, notice: t('compareFailed', { reason: messageOf(error) }) })
          }
        }

        const toggleCompare = (id) => {
          const state = store.getSnapshot()
          const compareIds = state.compareIds.includes(id)
            ? state.compareIds.filter((entry) => entry !== id)
            : state.compareIds.length + state.compareExtra.length >= 3
              ? state.compareIds
              : [...state.compareIds, id]
          setState({ compareIds, multiCompare: null })
          if (store.getSnapshot().compareOpen) void loadMultiCompare()
        }

        const addCompareExtra = (root, id, name) => {
          const state = store.getSnapshot()
          if (state.compareIds.length + state.compareExtra.length >= 3) return
          if (state.compareExtra.some((entry) => entry.root === root && entry.id === id)) return
          setState({ compareExtra: [...state.compareExtra, { root, id, name }], multiCompare: null })
          if (store.getSnapshot().compareOpen) void loadMultiCompare()
        }

        const removeCompareExtra = (root, id) => {
          const state = store.getSnapshot()
          setState({
            compareExtra: state.compareExtra.filter((entry) => !(entry.root === root && entry.id === id)),
            multiCompare: null,
          })
          if (store.getSnapshot().compareOpen) void loadMultiCompare()
        }

        const openCompare = () => {
          if (compareRefsOf(store.getSnapshot()).length < 2) {
            setState({ notice: t('compareNeedTwo') })
            return
          }
          setState({ compareOpen: true, candidatesOpen: false, notice: null, compareExport: null, compareReport: null })
          if (store.getSnapshot().crossRoots === null) void loadCrossExperiments()
          void loadCompareReports()
          void loadMultiCompare()
        }

        const closeCompare = () => setState({ compareOpen: false })

        const setMultiCompareGroup = (group) => {
          setState({ multiGroup: group })
          void loadMultiCompare()
        }

        const setMultiCompareMetric = (metric) => setState({ multiMetric: metric })

        const exportCompare = async (format) => {
          const state = store.getSnapshot()
          const refs = compareRefsOf(state)
          if (state.root === null || state.multiCompare === null || state.multiMetric === '' || refs.length < 2) return
          try {
            const payload = await request('/compare/export', {
              method: 'POST',
              body: {
                root: state.root,
                refs,
                metric: state.multiMetric,
                groupBy: state.multiGroup === '' ? [] : [state.multiGroup],
                format,
              },
            })
            setState({ compareExport: payload.file, notice: t('exported', { path: payload.file.relative }) })
          } catch (error) {
            setState({ notice: t('exportFailed', { reason: messageOf(error) }) })
          }
        }

        const openCompareExport = async () => {
          const state = store.getSnapshot()
          if (state.root === null || state.compareExport === null) return
          try {
            await request('/compare/open', {
              method: 'POST',
              body: { root: state.root, path: state.compareExport.relative },
            })
            setState({ notice: t('openedExport') })
          } catch (error) {
            setState({ notice: t('exportFailed', { reason: messageOf(error) }) })
          }
        }

        const reportCompare = async (format = 'markdown') => {
          const state = store.getSnapshot()
          const refs = compareRefsOf(state)
          if (state.root === null || refs.length < 2) return
          setState({ busy: format === 'html' ? 'compareReportHtml' : 'compareReport', notice: null })
          try {
            const payload = await request('/compare/report', {
              method: 'POST',
              body: { root: state.root, refs, groupBy: state.multiGroup === '' ? [] : [state.multiGroup], format },
            })
            setState({ busy: null, compareReport: payload.report, notice: t('compareReportReady') })
            await loadCompareReports()
          } catch (error) {
            setState({ busy: null, notice: t('compareReportFailed', { reason: messageOf(error) }) })
          }
        }

        const openCompareReport = async (path) => {
          const state = store.getSnapshot()
          const target = typeof path === 'string' && path !== '' ? path : state.compareReport?.relative
          if (state.root === null || target === undefined) return
          try {
            await request('/compare/report/open', {
              method: 'POST',
              body: { root: state.root, path: target },
            })
          } catch (error) {
            setState({ notice: t('compareReportFailed', { reason: messageOf(error) }) })
          }
        }

        const loadCompareReports = async () => {
          const state = store.getSnapshot()
          if (state.root === null) return
          try {
            const payload = await request(`/compare/reports?root=${encodeURIComponent(state.root)}`)
            setState({ compareReports: Array.isArray(payload.reports) ? payload.reports : [] })
          } catch (error) {
            setState({ compareReports: [], notice: t('compareReportsFailed', { reason: messageOf(error) }) })
          }
        }

        const loadNotifications = async () => {
          const state = store.getSnapshot()
          if (state.root === null) return
          try {
            const payload = await request(`/notifications?root=${encodeURIComponent(state.root)}`)
            setState({ notifications: Array.isArray(payload.notifications) ? payload.notifications : [] })
          } catch {
            // keep the previous list on a transient read failure
          }
        }

        const markNotificationsRead = async () => {
          const state = store.getSnapshot()
          if (state.root === null) return
          try {
            const payload = await request('/notifications/read', { method: 'POST', body: { root: state.root } })
            setState({ notifications: Array.isArray(payload.notifications) ? payload.notifications : [] })
          } catch (error) {
            setState({ notice: t('scheduleFailed', { reason: messageOf(error) }) })
          }
        }

        const markNotificationRead = async (id, root) => {
          const state = store.getSnapshot()
          const target = typeof root === 'string' && root !== '' ? root : state.root
          if (target === null) return
          try {
            const payload = await request('/notifications/read', {
              method: 'POST',
              body: { root: target, ids: [id] },
            })
            if (target === state.root) {
              setState({ notifications: Array.isArray(payload.notifications) ? payload.notifications : [] })
            }
          } catch (error) {
            setState({ notice: t('scheduleFailed', { reason: messageOf(error) }) })
          }
        }

        const openNotification = async (note) => {
          const state = store.getSnapshot()
          if (state.root === null || typeof note?.experimentId !== 'string') return
          setState({ sweepOpen: true, candidatesOpen: false, compareOpen: false, notice: null })
          await loadExperiment(state.root, note.experimentId)
          await markNotificationRead(note.id)
        }

        const loadAllNotifications = async () => {
          setState({ allNotificationsLoading: true })
          try {
            const payload = await request('/notifications/all')
            setState({
              allNotificationsLoading: false,
              allNotifications: Array.isArray(payload.notifications) ? payload.notifications : [],
            })
          } catch (error) {
            setState({ allNotificationsLoading: false, notice: t('scheduleFailed', { reason: messageOf(error) }) })
          }
        }

        const openNotificationCenter = () => {
          setState({ notificationCenterOpen: true, candidatesOpen: false, compareOpen: false, notice: null })
          void loadAllNotifications()
        }

        const closeNotificationCenter = () => setState({ notificationCenterOpen: false })

        const markCenterNotificationRead = async (note) => {
          await markNotificationRead(note.id, note.root)
          await loadAllNotifications()
        }

        const openAllNotification = async (note) => {
          const state = store.getSnapshot()
          if (typeof note?.experimentId !== 'string') return
          const targetRoot = typeof note.root === 'string' && note.root !== '' ? note.root : state.root
          if (targetRoot === null) return
          setState({ notificationCenterOpen: false, sweepOpen: true, candidatesOpen: false, compareOpen: false, notice: null })
          if (targetRoot !== state.root) chooseRoot(targetRoot)
          await loadExperiment(targetRoot, note.experimentId)
          await markNotificationRead(note.id, targetRoot)
          await loadAllNotifications()
        }

        const resumeSchedule = async (note) => {
          const state = store.getSnapshot()
          const targetRoot = typeof note?.root === 'string' && note.root !== '' ? note.root : state.root
          if (targetRoot === null || typeof note.experimentId !== 'string' || typeof note.scheduleId !== 'string') return
          try {
            await request('/schedule', {
              method: 'POST',
              body: {
                root: targetRoot,
                experimentId: note.experimentId,
                action: 'resume-run',
                scheduleId: note.scheduleId,
              },
            })
            await markNotificationRead(note.id, targetRoot)
            await loadAllNotifications()
            if (targetRoot === state.root) await loadExperiment(targetRoot, note.experimentId)
            setState({ notice: t('scheduleResumed') })
          } catch (error) {
            setState({ notice: t('scheduleFailed', { reason: messageOf(error) }) })
          }
        }

        const loadScheduleReports = async (scheduleId) => {
          const state = store.getSnapshot()
          if (state.root === null || state.selectedId === null) return
          try {
            const params = new URLSearchParams({
              root: state.root,
              experimentId: state.selectedId,
              scheduleId,
            })
            const payload = await request(`/schedule/reports?${params.toString()}`)
            setState({ scheduleReports: Array.isArray(payload.reports) ? payload.reports : [] })
          } catch {
            setState({ scheduleReports: [] })
          }
        }

        const openSearch = () => {
          setState({
            searchOpen: true,
            notificationCenterOpen: false,
            scheduleDetailId: null,
            compareOpen: false,
            candidatesOpen: false,
            notice: null,
          })
          void runSearch()
        }
        const closeSearch = () => setState({ searchOpen: false })
        const setSearchQuery = (query) => setState({ searchQuery: query })
        const setSearchStatus = (status) => setState({ searchStatus: status })

        const runSearch = async () => {
          const state = store.getSnapshot()
          if (state.root === null) return
          setState({ searchLoading: true })
          try {
            const params = new URLSearchParams({
              root: state.root,
              q: state.searchQuery ?? '',
              status: state.searchStatus ?? '',
              limit: '50',
            })
            const payload = await request(`/search?${params.toString()}`)
            setState({ searchLoading: false, searchResults: Array.isArray(payload.results) ? payload.results : [] })
          } catch (error) {
            setState({ searchLoading: false, notice: t('listFailed', { reason: messageOf(error) }) })
          }
        }

        const openSearchResult = async (result) => {
          const state = store.getSnapshot()
          if (state.root === null) return
          await loadExperiment(state.root, result.experimentId)
          setState({ searchOpen: false, runId: result.run.id })
        }

        const reproduceRunConfirmed = async () => {
          const state = store.getSnapshot()
          if (state.root === null || state.selectedId === null || state.runId === null) return
          setState({ busy: 'reproduce', notice: null })
          try {
            const payload = await request('/reproduce', {
              method: 'POST',
              body: {
                root: state.root,
                experimentId: state.selectedId,
                runId: state.runId,
                confirm: true,
              },
            })
            await loadExperiment(state.root, state.selectedId)
            if (payload.run.status !== 'ok') {
              const reason = payload.run.stderrTail || payload.run.error || `exit ${payload.run.exitCode ?? '—'}`
              setState({
                busy: null,
                runId: payload.run.id,
                notice: t('reproduceFailedRun', { reason: String(reason).slice(0, 300) }),
              })
            } else {
              setState({ busy: null, runId: payload.run.id, notice: t('reproduced') })
            }
          } catch (error) {
            setState({ busy: null, notice: t('reproduceFailed', { reason: messageOf(error) }) })
          }
        }

        const reproduceRun = () => {
          const state = store.getSnapshot()
          const run = (state.detail?.runs ?? []).find((entry) => entry.id === state.runId)
          const command = run?.manifest?.command ?? run?.command ?? ''
          askConfirm({
            message: `${t('reproduceConfirm')}\n${String(command).slice(0, 300)}`,
            label: t('reproduce'),
            danger: false,
            run: reproduceRunConfirmed,
          })
        }

        const updateExperiment = async (patch) => {
          const state = store.getSnapshot()
          if (state.root === null || state.selectedId === null) return
          try {
            await request('/update', {
              method: 'POST',
              body: { root: state.root, experimentId: state.selectedId, ...patch },
            })
            await loadExperiment(state.root, state.selectedId)
            await loadList(state.root)
            setState({ notice: t('experimentSaved') })
          } catch (error) {
            setState({ notice: t('updateFailed', { reason: messageOf(error) }) })
          }
        }

        const updateRun = async (runId, notes) => {
          const state = store.getSnapshot()
          if (state.root === null || state.selectedId === null) return
          try {
            await request('/run/update', {
              method: 'POST',
              body: { root: state.root, experimentId: state.selectedId, runId, notes },
            })
            await loadExperiment(state.root, state.selectedId)
            setState({ notice: t('notesSaved') })
          } catch (error) {
            setState({ notice: t('updateFailed', { reason: messageOf(error) }) })
          }
        }

        const askConfirm = (options) => setState({ confirm: options })
        const closeConfirm = () => setState({ confirm: null })
        const confirmYes = async () => {
          const current = store.getSnapshot().confirm
          setState({ confirm: null })
          if (current !== null && typeof current.run === 'function') await current.run()
        }

        const deleteRunConfirmed = async (runId) => {
          const state = store.getSnapshot()
          if (state.root === null || state.selectedId === null) return
          try {
            await request('/run/delete', {
              method: 'POST',
              body: { root: state.root, experimentId: state.selectedId, runId, confirm: true },
            })
            await loadExperiment(state.root, state.selectedId)
            await loadList(state.root)
            setState({ runId: null, notice: t('runDeleted') })
          } catch (error) {
            setState({ notice: t('updateFailed', { reason: messageOf(error) }) })
          }
        }
        const deleteRun = (runId) => askConfirm({
          message: t('deleteRunConfirm'),
          label: t('deleteRun'),
          danger: true,
          run: () => deleteRunConfirmed(runId),
        })

        const toggleShowArchived = () => {
          setState({ showArchived: !store.getSnapshot().showArchived })
        }

        const exportLedger = async () => {
          const state = store.getSnapshot()
          if (state.root === null) return
          try {
            const payload = await request('/export', {
              method: 'POST',
              body: { root: state.root },
            })
            setState({ notice: t('exportReady', { path: payload.bundle.path }) })
          } catch (error) {
            setState({ notice: t('transferFailed', { reason: messageOf(error) }) })
          }
        }

        const exportLedgerZip = async () => {
          const state = store.getSnapshot()
          if (state.root === null) return
          try {
            const payload = await request('/export', {
              method: 'POST',
              body: { root: state.root, format: 'zip' },
            })
            setState({ notice: t('exportReady', { path: payload.bundle.path }) })
          } catch (error) {
            setState({ notice: t('transferFailed', { reason: messageOf(error) }) })
          }
        }

        const openConclusion = (status = 'draft') => {
          const state = store.getSnapshot()
          if (state.root === null || state.selectedId === null) return
          setState({
            conclusionOpen: true,
            conclusionText: state.detail?.conclusion?.text ?? '',
            conclusionStatus: status,
            conclusionNote: '',
            conclusionError: null,
            conclusionBusy: false,
          })
        }
        const closeConclusion = () => setState({ conclusionOpen: false, conclusionError: null, conclusionBusy: false })
        const setConclusionText = (value) => setState({ conclusionText: value })
        const setConclusionNote = (value) => setState({ conclusionNote: value })
        const setReviewerName = (value) => {
          setState({ reviewerName: value })
          try {
            window.localStorage.setItem('experiment-ledger:reviewer', value)
          } catch {
            // ignore storage failures
          }
        }
        const setReviewerRole = (value) => {
          setState({ reviewerRole: value })
          try {
            window.localStorage.setItem('experiment-ledger:role', value)
          } catch {
            // ignore storage failures
          }
        }
        const saveConclusion = async (status) => {
          const state = store.getSnapshot()
          if (state.root === null || state.selectedId === null) return
          const text = state.conclusionText.trim()
          if ((status === 'approved' || status === 'rejected') && text === '') {
            setState({ conclusionError: t('conclusionFailed', { reason: 'approved/rejected need text' }) })
            return
          }
          setState({ conclusionBusy: true, conclusionError: null })
          try {
            await request('/conclude', {
              method: 'POST',
              body: {
                root: state.root,
                experimentId: state.selectedId,
                text,
                status,
                note: state.conclusionNote.trim() === '' ? undefined : state.conclusionNote.trim(),
                decidedBy: state.reviewerName.trim() === '' ? undefined : state.reviewerName.trim(),
                role: state.reviewerRole.trim() === '' ? undefined : state.reviewerRole.trim(),
              },
            })
            await loadExperiment(state.root, state.selectedId)
            await loadList(state.root)
            setState({ conclusionBusy: false, conclusionOpen: false, notice: t('conclusionSaved') })
          } catch (error) {
            setState({ conclusionBusy: false, conclusionError: t('conclusionFailed', { reason: messageOf(error) }) })
          }
        }

        const askDeleteExperiment = (id) => setState({ pendingDeleteId: id })
        const cancelDeleteExperiment = () => setState({ pendingDeleteId: null })
        const deleteExperiment = async (id) => {
          const state = store.getSnapshot()
          if (state.root === null || typeof id !== 'string') return
          try {
            await request('/experiment/delete', {
              method: 'POST',
              body: { root: state.root, experimentId: id, confirm: true },
            })
            const name = state.experiments.find(entry => entry.id === id)?.name ?? id
            setState({
              pendingDeleteId: null,
              selectedId: state.selectedId === id ? null : state.selectedId,
              detail: state.selectedId === id ? null : state.detail,
              notice: t('deletedExperiment', { name }),
            })
            await loadList(state.root)
          } catch (error) {
            setState({ pendingDeleteId: null, notice: t('deleteFailed', { reason: messageOf(error) }) })
          }
        }

        const cloneExperiment = async () => {          const state = store.getSnapshot()
          if (state.root === null || state.selectedId === null) return
          try {
            const payload = await request('/clone', {
              method: 'POST',
              body: { root: state.root, experimentId: state.selectedId },
            })
            await loadList(state.root)
            await chooseExperiment(payload.experiment.id)
            setState({ notice: t('cloned', { name: payload.experiment.name }) })
          } catch (error) {
            setState({ notice: t('updateFailed', { reason: messageOf(error) }) })
          }
        }

        const openScheduleDetail = (scheduleId) => {          setState({ scheduleDetailId: scheduleId, scheduleReport: null, scheduleReports: [] })
          void loadScheduleReports(scheduleId)
        }
        const closeScheduleDetail = () => setState({ scheduleDetailId: null, scheduleReport: null, scheduleReports: [] })

        const reportSchedule = async (scheduleId) => {
          const state = store.getSnapshot()
          if (state.root === null || state.selectedId === null) return
          setState({ busy: 'scheduleReport', notice: null })
          try {
            const payload = await request('/schedule', {
              method: 'POST',
              body: {
                root: state.root,
                experimentId: state.selectedId,
                action: 'report',
                scheduleId,
              },
            })
            setState({ busy: null, scheduleReport: payload.report, notice: t('scheduleReportReady') })
            await loadScheduleReports(scheduleId)
          } catch (error) {
            setState({ busy: null, notice: t('scheduleFailed', { reason: messageOf(error) }) })
          }
        }

        const openScheduleReport = async (path) => {
          const state = store.getSnapshot()
          const target = typeof path === 'string' && path !== '' ? path : state.scheduleReport?.relative
          if (state.root === null || target === undefined) return
          try {
            await request('/compare/report/open', {
              method: 'POST',
              body: { root: state.root, path: target },
            })
          } catch (error) {
            setState({ notice: t('scheduleFailed', { reason: messageOf(error) }) })
          }
        }

        const markNotificationsReadBulk = async (notes) => {
          const state = store.getSnapshot()
          const byRoot = new Map()
          for (const note of notes ?? []) {
            if (typeof note.root !== 'string' || note.read === true) continue
            if (!byRoot.has(note.root)) byRoot.set(note.root, [])
            byRoot.get(note.root).push(note.id)
          }
          let ok = 0
          let failed = 0
          for (const [root, ids] of byRoot) {
            try {
              await request('/notifications/read', { method: 'POST', body: { root, ids } })
              ok += ids.length
            } catch (error) {
              failed += ids.length
              setState({ notice: t('scheduleFailed', { reason: messageOf(error) }) })
            }
          }
          setState({ bulkResult: { kind: 'read', ok, failed, failedNotes: [] } })
          await loadAllNotifications()
          if (state.root !== null && byRoot.has(state.root)) await loadNotifications()
        }

        const resumeSchedules = async (notes) => {
          const state = store.getSnapshot()
          const seen = new Set()
          const failedNotes = []
          let ok = 0
          for (const note of notes ?? []) {
            if (note.action !== 'resume-run') continue
            if (typeof note.root !== 'string' || typeof note.experimentId !== 'string' || typeof note.scheduleId !== 'string') continue
            const key = `${note.root}::${note.scheduleId}`
            if (seen.has(key)) continue
            seen.add(key)
            try {
              await request('/schedule', {
                method: 'POST',
                body: {
                  root: note.root,
                  experimentId: note.experimentId,
                  action: 'resume-run',
                  scheduleId: note.scheduleId,
                },
              })
              await markNotificationRead(note.id, note.root)
              ok += 1
            } catch (error) {
              failedNotes.push(note)
              setState({ notice: t('scheduleFailed', { reason: messageOf(error) }) })
            }
          }
          if (seen.size === 0) return
          setState({ bulkResult: { kind: 'resume', ok, failed: failedNotes.length, failedNotes } })
          await loadAllNotifications()
          if (state.root !== null) await loadNotifications()
          if (state.root !== null && state.selectedId !== null) await loadExperiment(state.root, state.selectedId)
          setState({ notice: t('scheduleResumed') })
        }

        const saveSchedule = async (name, preset, intervalMinutes, retry) => {
          const state = store.getSnapshot()
          if (state.root === null || state.selectedId === null) return
          try {
            await request('/schedule', {
              method: 'POST',
              body: {
                root: state.root,
                experimentId: state.selectedId,
                action: 'save',
                name,
                preset,
                intervalMinutes,
                retryLimit: retry?.retryLimit,
                retryDelayMs: retry?.retryDelayMs,
                failureLimit: retry?.failureLimit,
              },
            })
            await loadExperiment(state.root, state.selectedId)
            setState({ notice: t('scheduleSaved') })
          } catch (error) {
            setState({ notice: t('scheduleFailed', { reason: messageOf(error) }) })
          }
        }

        const deleteSchedule = async (scheduleId) => {
          const state = store.getSnapshot()
          if (state.root === null || state.selectedId === null) return
          try {
            await request('/schedule', {
              method: 'POST',
              body: { root: state.root, experimentId: state.selectedId, action: 'delete', scheduleId },
            })
            await loadExperiment(state.root, state.selectedId)
          } catch (error) {
            setState({ notice: t('scheduleFailed', { reason: messageOf(error) }) })
          }
        }

        const toggleSchedule = async (scheduleId, enabled) => {
          const state = store.getSnapshot()
          if (state.root === null || state.selectedId === null) return
          try {
            await request('/schedule', {
              method: 'POST',
              body: { root: state.root, experimentId: state.selectedId, action: 'toggle', scheduleId, enabled },
            })
            await loadExperiment(state.root, state.selectedId)
          } catch (error) {
            setState({ notice: t('scheduleFailed', { reason: messageOf(error) }) })
          }
        }

        const runSchedule = async (scheduleId) => {
          const state = store.getSnapshot()
          if (state.root === null || state.selectedId === null) return
          try {
            await request('/schedule', {
              method: 'POST',
              body: { root: state.root, experimentId: state.selectedId, action: 'run', scheduleId },
            })
            await loadExperiment(state.root, state.selectedId)
          } catch (error) {
            setState({ notice: t('scheduleFailed', { reason: messageOf(error) }) })
          }
        }

        const savePreset = async (name, form) => {
          const state = store.getSnapshot()
          if (state.root === null || state.selectedId === null) return
          try {
            await request('/preset', {
              method: 'POST',
              body: { root: state.root, experimentId: state.selectedId, action: 'save', name, ...form },
            })
            await loadExperiment(state.root, state.selectedId)
            setState({ notice: t('presetSaved') })
          } catch (error) {
            setState({ notice: t('presetFailed', { reason: messageOf(error) }) })
          }
        }

        const deletePreset = async (presetId) => {
          const state = store.getSnapshot()
          if (state.root === null || state.selectedId === null) return
          try {
            await request('/preset', {
              method: 'POST',
              body: { root: state.root, experimentId: state.selectedId, action: 'delete', presetId },
            })
            await loadExperiment(state.root, state.selectedId)
          } catch (error) {
            setState({ notice: t('presetFailed', { reason: messageOf(error) }) })
          }
        }

        const startSweep = async (form) => {
          const state = store.getSnapshot()
          if (state.root === null || state.selectedId === null) return
          setState({ notice: null, sweepJob: null })
          try {
            const payload = await request('/sweep', {
              method: 'POST',
              body: { root: state.root, experimentId: state.selectedId, ...form },
            })
            setState({ sweepJob: payload.job })
          } catch (error) {
            setState({ notice: t('sweepFailed', { reason: messageOf(error) }) })
          }
        }

        const refreshSweep = async () => {
          const state = store.getSnapshot()
          if (state.sweepJob === null) return
          try {
            const payload = await request(`/sweep/status?jobId=${encodeURIComponent(state.sweepJob.id)}`)
            setState({ sweepJob: payload.job })
            if (payload.job.status !== 'running') {
              const current = store.getSnapshot()
              if (current.root !== null && current.selectedId !== null) {
                await loadList(current.root)
                await loadExperiment(current.root, current.selectedId)
              }
            }
          } catch (error) {
            setState({ notice: t('sweepFailed', { reason: messageOf(error) }) })
          }
        }

        const stopSweep = async () => {
          const state = store.getSnapshot()
          if (state.sweepJob === null) return
          try {
            const payload = await request('/sweep/stop', {
              method: 'POST',
              body: { jobId: state.sweepJob.id },
            })
            setState({ sweepJob: payload.job })
          } catch (error) {
            setState({ notice: t('sweepFailed', { reason: messageOf(error) }) })
          }
        }

        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'experiment-ledger',
          order: 41,
          label: () => t('open'),
          inject: () => ({ open, t, pollPanelRequest }),
        }, FooterAction))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'experiment-ledger',
          order: 41,
          inject: () => ({
            hooks: { dialog: store },
            t,
            close,
            refresh,
            chooseRoot,
            openRootPicker,
            closeRootPicker,
            browseRoots,
            setRootPath,
            openRootFolder,
            openRootPath,
            openImport,
            closeImport,
            importFile,
            toggleSidebar,
            chooseExperiment,
            chooseRun,
            backToRuns,
            openCandidates,
            closeCandidates,
            openReviews,
            closeReviews,
            reviewExperiments,
            approveAllReviews,
            promote,
            generateReport,
            toggleSweep,
            startSweep,
            refreshSweep,
            stopSweep,
            openReport,
            addBaseline,
            removeBaseline,
            toggleCompare,
            openCompare,
            closeCompare,
            loadMultiCompare,
            setMultiCompareGroup,
            setMultiCompareMetric,
            exportCompare,
            openCompareExport,
            addCompareExtra,
            removeCompareExtra,
            reportCompare,
            openCompareReport,
            savePreset,
            deletePreset,
            saveSchedule,
            deleteSchedule,
            toggleSchedule,
            runSchedule,
            loadNotifications,
            markNotificationsRead,
            markNotificationRead,
            openNotification,
            loadAllNotifications,
            openNotificationCenter,
            closeNotificationCenter,
            markCenterNotificationRead,
            openAllNotification,
            resumeSchedule,
            openScheduleDetail,
            closeScheduleDetail,
            markNotificationsReadBulk,
            resumeSchedules,
            reportSchedule,
            openScheduleReport,
            openSearch,
            closeSearch,
            setSearchQuery,
            setSearchStatus,
            runSearch,
            openSearchResult,
            reproduceRun,
            updateExperiment,
            updateRun,
            deleteRun,
            toggleShowArchived,
            exportLedger,
            exportLedgerZip,
            cloneExperiment,
            openConclusion,
            closeConclusion,
            saveConclusion,
            setConclusionText,
            setConclusionNote,
            setReviewerName,
            setReviewerRole,
            askDeleteExperiment,
            cancelDeleteExperiment,
            deleteExperiment,
            confirmYes,
            closeConfirm,
          }),
        }, Dialog))
      },
    }
  },
})
