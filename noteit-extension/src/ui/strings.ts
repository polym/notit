// All Chinese UI copy (architecture.md "Naming Patterns": copy lives only in ui/strings.ts).
// Error codes map to text only through errorText(code). Manifest copy (name, description, command
// description, context menu title) also lives in public/_locales/zh_CN/messages.json; the menu
// title there must equal the one below (checked by strings.test.ts).
import type { ErrorCode } from '../core/messaging/types.ts'

export const strings = {
  appName: 'NoteIt',
  menuHighlightSelection: '摘抄选中文字',
  anchorLost: '页面上未找到此摘抄',
  loginEmail: '邮箱',
  loginPassword: '密码',
  loginSubmit: '登录',
  loginInvalidCredentials: '邮箱或密码不正确',
  // Login page server settings (spec "login-supabase-config", variant A).
  server: '服务器',
  serverNotConfigured: '未配置',
  serverSourceBuild: '默认',
  serverSourceUser: '自定义',
  serverNoneNotice: '这个版本没有内置服务器。先在下方填写你的 Supabase 项目，再登录。',
  serverUrl: '项目 URL',
  serverAnonKey: 'anon key',
  serverShowKey: '显示',
  serverHideKey: '隐藏',
  serverTest: '测试',
  serverSave: '保存',
  serverReset: '恢复默认',
  serverTesting: '正在连接…',
  serverTestOk: '连接成功',
  serverTestNetwork: '无法连接服务器，请检查地址',
  serverTestRejected: '服务器拒绝了这个 key',
  serverUrlInvalid: '请输入完整地址，例如 https://xxxx.supabase.co',
  serverUrlInsecure: '只支持 https 地址，本地 localhost / 127.0.0.1 可用 http',
  serverKeyMissing: '请填写 anon key',
  serverKeyInvalid: 'key 格式不正确',
  serverKeySecret: '这是高权限密钥，请改用 anon / publishable key',
  syncPending: (count: number) => `${count} 条待同步`,
  syncRetry: '重试',
  // Header sync-status (Story 3.10): button label and the polite live-region announcement.
  syncStatusLabel: (detail: string) => `同步状态：${detail}`,
  syncSynced: '已同步',
  syncFailedState: '同步失败',
  syncDetails: '同步详情',
  listJoin: '，',
  account: '账户',
  accountEmail: '登录邮箱',
  accountLastSync: '上次同步',
  accountNeverSynced: '尚未同步',
  accountPending: '待同步',
  accountServer: '服务器',
  logout: '退出登录',
  accountBack: '返回',
  logoutCancel: '取消',
  logoutConfirm: (count: number) => `有 ${count} 条摘抄尚未同步，退出后将丢失。确认退出吗？`,
  debugTitle: 'NoteIt 诊断',
  debugSyncStatus: '同步状态',
  debugOutbox: (count: number) => `待上传队列（${count}）`,
  debugLogs: (count: number) => `最近日志（${count}）`,
  debugExport: '导出本地 id 清单',
  debugExported: (count: number) => `已导出 ${count} 条`,
  debugLoadFailed: '读取失败',

  // EXPERIENCE.md Voice and Tone / State Patterns fixed copy. Composite rows ("A · B") are a text and
  // an action shown side by side, so each part is its own entry.
  emptyCurrentPage: '选中文字即可摘抄，或按 ⌘⇧H',
  // Same hint off macOS (EXPERIENCE "Keyboard": Ctrl+Shift+H on Windows / Linux, as in the manifest).
  emptyCurrentPageCtrl: '选中文字即可摘抄，或按 Ctrl+Shift+H',
  siteOn: '本站已开启',
  emptyAllSites: '还没有摘抄。打开任意网页，选中文字即可开始',
  siteOff: '本站未开启',
  siteTurnOn: '开启',
  deleted: '已删除',
  undo: '撤销',
  pageUnsupported: '此页面不支持摘抄',
  // unsupported-notice (Story 3.11, FR44): browsers without the Side Panel API, such as Arc.
  browserUnsupported: '当前浏览器不支持侧栏，NoteIt 暂时无法使用。请在 Chrome 或 Edge 中打开',
  separator: ' · ',

  // Side panel shell (Story 3.3): module tab row label and the highlight module tab.
  moduleTabs: '模块',
  moduleHighlight: '摘抄',

  // Side panel views and actions.
  loading: '正在读取',
  viewCurrentPage: '当前页',
  viewAllSites: '全部网站',
  viewSwitch: '视图',
  itemCount: (count: number) => `${count} 条摘抄`,
  highlightList: '摘抄列表',
  // Highlight color names (DESIGN.md "Colors": every color carries its text name).
  colorYellow: '摘抄',
  colorOrange: '重点',
  colorBlue: '疑问',
  colorGreen: '收藏',
  dateToday: '今天',
  dateYesterday: '昨天',
  dateThisWeek: '本周',
  dateEarlier: '更早',
  deleteHighlight: '删除',

  // In-page floating menu (mockups/key-in-page-overlays.html: toolbar and comment button names).
  floatingMenuLabel: '摘抄',
  commentButton: '批注',
  // In-page highlight popover (mockups/key-in-page-overlays.html scene 3: dialog name).
  highlightPopoverLabel: '编辑摘抄',

  // In-page comment editor.
  commentAdd: '添加批注',
  commentEdit: '编辑批注',
  commentPlaceholder: '写下你的想法',
  commentSave: '保存',
  commentSaveHint: '⌘↵ 保存',
  commentSaveHintCtrl: 'Ctrl+Enter 保存',
  commentCancel: '取消',
  // In-page comment preview title.
  commentPreviewTitle: '你的批注',
  close: '关闭',

  // Selection translation settings (spec "selection translation").
  translateSettings: '划词翻译',
  translateNotConfigured: '未配置',
  translateConfigured: (hint: string) => `已配置 ···${hint}`,
  translateBaseUrl: '接口地址',
  translateModel: '模型',
  translateApiKey: 'API Key',
  translateApiKeyKeep: '留空则保留已保存的 Key',
  translatePrivacyNote: '只有在你点击「翻译」时，选中的文字和所在句子才会发送到上面的接口；费用由你的账户承担。',
  translateTesting: '正在测试…',
  translateTestOk: '可以正常翻译',
  translateSaved: '已保存',
  translatePermissionDenied: '未授予访问该接口的权限，翻译可能无法连接',
  translateBaseUrlInvalid: '请输入 https 地址，例如 https://api.deepseek.com',
  translateModelMissing: '请填写模型名',
  translateKeyMissing: '请填写 API Key',
  // In-page translate card.
  translateButton: '翻译',
  translateCardLabel: '翻译',
  translateLoading: '正在翻译…',
  translateRetry: '重试',
  translateOpenSettings: '打开翻译设置',
  translateHighlight: '摘抄',
  translateInsert: '插入译文',
  translatePronounce: '朗读',
  translateNoVoice: '没有可用的英文语音',
  translateIpaUs: '美',
  translateIpaUk: '英',
  translatePronounceUnavailable: '朗读（没有可用的英文语音）',
  translateOtherSensesLine: (list: string) => `其他释义：${list}`,
  translateTooLong: '选中的文字太长，请缩短后再翻译',
  menuTranslateSelection: '用 NoteIt 翻译',
} as const

/** Error text for translation requests; the highlight copy in ERROR_TEXT talks about saving. */
const TRANSLATE_ERROR_TEXT: Record<ErrorCode, string> = {
  unauthenticated: 'API Key 无效，请在侧栏检查翻译设置',
  network: '无法连接翻译接口，请检查网络或接口权限后重试',
  server: '翻译服务暂时不可用，请稍后重试',
  conflict_rejected: '翻译没有完成，请重试',
  bad_request: '翻译结果解析失败，请重试',
  not_found: '翻译没有完成，请重试',
  quota: '翻译额度不足或请求过于频繁，请检查账户余额后重试',
  not_configured: '还没有配置翻译，请在侧栏填写 API Key',
  internal: '翻译没有完成，请重试',
}

export function translateErrorText(code: ErrorCode): string {
  return TRANSLATE_ERROR_TEXT[code]
}

const ERROR_TEXT: Record<ErrorCode, string> = {
  unauthenticated: '尚未登录，请先在侧栏登录',
  network: '无法连接，请检查网络后重试',
  server: '服务暂时不可用，请稍后重试',
  conflict_rejected: '保存未完成，请重试',
  bad_request: '保存未完成，请重试',
  not_found: '这条摘抄已不存在',
  quota: '本机存储空间不足，摘抄没有保存',
  not_configured: '尚未配置服务器，请先在登录页填写 Supabase 项目',
  internal: '保存未完成，请重试',
}

export function errorText(code: ErrorCode): string {
  return ERROR_TEXT[code]
}
