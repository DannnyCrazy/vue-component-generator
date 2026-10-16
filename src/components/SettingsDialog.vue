<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { PROVIDER_PRESETS } from '@/config/presets'
import { AiError, listModels, testProvider } from '@/services/aiClient'
import { buildSystemPrompt } from '@/services/prompts'
import {
  activeProfile,
  addProfile,
  applyPreset,
  duplicateProfile,
  removeProfile,
  resetAllSettings,
  selectProfile,
  settingsState,
  updateActiveProfile,
} from '@/stores/settings'
import { toast } from '@/composables/useToast'
import { clamp } from '@/utils/misc'

const props = defineProps<{ open: boolean; tab?: 'platform' | 'generation' }>()
const emit = defineEmits<{ (event: 'update:open', value: boolean): void }>()

const activeTab = ref<'platform' | 'generation' | 'preview'>('platform')
const showKey = ref(false)
const testing = ref(false)
const testResult = ref<{ ok: boolean; text: string } | null>(null)
const loadingModels = ref(false)
const showSystemPrompt = ref(false)
let testController: AbortController | null = null

const systemPromptPreview = computed(() => buildSystemPrompt(settingsState.generation))

const profile = computed(() => activeProfile.value)
const currentPreset = computed(() => PROVIDER_PRESETS.find((item) => item.id === profile.value?.presetId))
const visible = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
})

watch(
  () => props.open,
  (open) => {
    if (open) {
      activeTab.value = props.tab ?? 'platform'
      testResult.value = null
      showKey.value = false
    }
  },
)

watch(activeTab, () => {
  testResult.value = null
})

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.open) visible.value = false
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  testController?.abort()
})

function onPresetChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  applyPreset(value)
  const preset = PROVIDER_PRESETS.find((item) => item.id === value)
  toast(`已套用预设：${preset?.name ?? value}`, 'ok')
}

async function onTest(): Promise<void> {
  const target = profile.value
  if (!target) return
  testing.value = true
  testResult.value = null
  const controller = new AbortController()
  testController = controller
  const timeout = window.setTimeout(() => controller.abort(), 30000)
  try {
    const { ms, sample } = await testProvider(target, controller.signal)
    testResult.value = {
      ok: true,
      text: `连通正常 · 耗时 ${Math.round(ms)} ms${sample ? ` · 模型回复：${sample}` : ''}`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const hint = error instanceof AiError ? (error.hint ?? '') : ''
    testResult.value = { ok: false, text: hint ? `${message} —— ${hint}` : message }
  } finally {
    window.clearTimeout(timeout)
    testing.value = false
    testController = null
  }
}

async function onFetchModels(): Promise<void> {
  const target = profile.value
  if (!target) return
  loadingModels.value = true
  try {
    const models = await listModels(target)
    updateActiveProfile({ models })
    if (!models.includes(target.model)) updateActiveProfile({ model: models[0] })
    toast(`已获取 ${models.length} 个模型`, 'ok')
  } catch (error) {
    toast(error instanceof Error ? error.message : '获取模型列表失败', 'err', 4000)
  } finally {
    loadingModels.value = false
  }
}

function onReset(): void {
  resetAllSettings()
  toast('已恢复默认设置', 'ok')
}

function onRemoveCurrent(): void {
  const target = profile.value
  if (!target || settingsState.profiles.length <= 1) {
    toast('至少需要保留一个平台配置', 'err')
    return
  }
  removeProfile(target.id)
  toast('已删除该平台配置', 'info')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-mask" @click.self="visible = false">
      <div class="modal settings-modal">
        <header class="modal-head">
          <AppIcon name="gear" :size="17" />
          <strong>设置</strong>
          <div class="tabs">
            <button class="tab" :class="{ active: activeTab === 'platform' }" type="button" @click="activeTab = 'platform'">
              AI 平台
            </button>
            <button class="tab" :class="{ active: activeTab === 'generation' }" type="button" @click="activeTab = 'generation'">
              生成偏好
            </button>
            <button class="tab" :class="{ active: activeTab === 'preview' }" type="button" @click="activeTab = 'preview'">
              预览与界面
            </button>
          </div>
          <button class="btn btn-icon" type="button" title="关闭" @click="visible = false">
            <AppIcon name="close" :size="15" />
          </button>
        </header>

        <!-- ============ AI 平台 ============ -->
        <div v-if="activeTab === 'platform'" class="modal-body platform-body">
          <aside class="profile-list">
            <div class="profile-list-head">
              <span class="label">平台配置</span>
              <button class="btn btn-sm btn-ghost" type="button" title="新增自定义平台" @click="addProfile('custom')">
                <AppIcon name="plus" :size="13" />
              </button>
            </div>
            <button
              v-for="item in settingsState.profiles"
              :key="item.id"
              class="profile-item"
              :class="{ active: item.id === settingsState.activeProfileId }"
              type="button"
              @click="selectProfile(item.id)"
            >
              <span class="p-dot" :class="{ on: item.apiKey || /localhost|127\.0\.0\.1/.test(item.baseUrl) }"></span>
              <span class="p-info">
                <span class="truncate">{{ item.name }}</span>
                <small class="truncate">{{ item.model || '未选择模型' }}</small>
              </span>
            </button>
            <div class="profile-list-foot">
              <button class="btn btn-sm btn-ghost" type="button" @click="duplicateProfile(settingsState.activeProfileId)">
                <AppIcon name="copy" :size="12" />
                复制
              </button>
              <button class="btn btn-sm btn-ghost" type="button" @click="onRemoveCurrent">
                <AppIcon name="trash" :size="12" />
                删除
              </button>
            </div>
          </aside>

          <div v-if="profile" class="profile-form scroll-y">
            <div class="notice info">
              <AppIcon name="link" :size="15" />
              <span>
                API Key 只保存在你本机浏览器（localStorage），不会上传到任何第三方；开启「本地代理转发」时，请求会经由本机
                Dev Server 转发到平台。
              </span>
            </div>

            <div class="grid-2">
              <div class="field">
                <label>平台预设</label>
                <select class="select" :value="profile.presetId" @change="onPresetChange">
                  <option v-for="preset in PROVIDER_PRESETS" :key="preset.id" :value="preset.id">
                    {{ preset.name }}
                  </option>
                </select>
                <span class="hint">选择预设会自动填入接口地址与常用模型，你仍可手动修改。</span>
                <span v-if="currentPreset?.note" class="hint preset-note">{{ currentPreset.note }}</span>
              </div>
              <div class="field">
                <label>配置名称</label>
                <input v-model="profile.name" class="input" type="text" placeholder="例如：我的 DeepSeek" />
              </div>
            </div>

            <div class="grid-2">
              <div class="field">
                <label>接口协议</label>
                <select v-model="profile.flavor" class="select">
                  <option value="openai">OpenAI 兼容（/chat/completions）</option>
                  <option value="anthropic">Anthropic Messages（/v1/messages）</option>
                </select>
              </div>
              <div class="field">
                <label>请求路径</label>
                <input v-model="profile.path" class="input mono" type="text" placeholder="/chat/completions" />
                <span class="hint">留空则按协议使用默认路径。</span>
              </div>
            </div>

            <div class="field">
              <label>Base URL</label>
              <input
                v-model="profile.baseUrl"
                class="input mono"
                type="text"
                placeholder="https://api.deepseek.com/v1"
                spellcheck="false"
              />
              <span class="hint">
                多数平台以 <code>/v1</code> 结尾。最终请求地址 = Base URL + 请求路径（若已包含则不会重复拼接）。
              </span>
            </div>

            <div class="field">
              <label>API Key</label>
              <div class="row">
                <input
                  v-model="profile.apiKey"
                  class="input mono grow"
                  :type="showKey ? 'text' : 'password'"
                  placeholder="sk-…"
                  spellcheck="false"
                  autocomplete="off"
                />
                <button class="btn" type="button" @click="showKey = !showKey">
                  <AppIcon name="eye" :size="14" />
                  {{ showKey ? '隐藏' : '显示' }}
                </button>
              </div>
              <span v-if="PROVIDER_PRESETS.find((p) => p.id === profile.presetId)?.keyUrl" class="hint">
                申请地址：
                <a :href="PROVIDER_PRESETS.find((p) => p.id === profile.presetId)?.keyUrl" target="_blank" rel="noreferrer">
                  {{ PROVIDER_PRESETS.find((p) => p.id === profile.presetId)?.keyUrl }}
                </a>
                （本地模型可留空）
              </span>
            </div>

            <div class="field">
              <label>模型</label>
              <div class="row">
                <input v-model="profile.model" class="input mono grow" list="acs-model-options" type="text" placeholder="deepseek-chat" />
                <button class="btn" type="button" :disabled="loadingModels" @click="onFetchModels">
                  <span v-if="loadingModels" class="spinner"></span>
                  <AppIcon v-else name="refresh" :size="14" />
                  拉取列表
                </button>
              </div>
              <datalist id="acs-model-options">
                <option v-for="model in profile.models" :key="model" :value="model"></option>
              </datalist>
              <span v-if="profile.models.length" class="hint">可用模型：{{ profile.models.slice(0, 8).join('、') }}</span>
            </div>

            <div class="grid-2">
              <div class="field">
                <label>温度（{{ profile.temperature }}）</label>
                <input
                  class="range"
                  type="range"
                  min="0"
                  max="1.5"
                  step="0.1"
                  :value="profile.temperature"
                  @input="profile.temperature = clamp(Number(($event.target as HTMLInputElement).value), 0, 1.5)"
                />
                <span class="hint">越低越稳定，生成代码建议 0.2 ~ 0.6。</span>
              </div>
              <div class="field">
                <label>最大输出 tokens</label>
                <input
                  class="input"
                  type="number"
                  min="256"
                  max="65536"
                  step="256"
                  :value="profile.maxTokens"
                  @input="profile.maxTokens = clamp(Number(($event.target as HTMLInputElement).value), 256, 65536)"
                />
                <span class="hint">复杂页面建议 8000 以上。</span>
              </div>
            </div>

            <div class="field">
              <label>额外请求头（JSON，可留空）</label>
              <textarea
                v-model="profile.extraHeaders"
                class="textarea mono"
                rows="2"
                spellcheck="false"
                placeholder='{"X-Custom-Header":"value"}'
              ></textarea>
            </div>

            <label class="switch proxy-switch">
              <input v-model="profile.useProxy" type="checkbox" />
              <span class="track"></span>
              <span>
                经由本地开发服务器转发
                <small class="hint">：浏览器直连被 CORS 拦截时打开。仅在 <code>pnpm dev</code> / <code>pnpm preview</code> 下有效。</small>
              </span>
            </label>

            <div class="test-row">
              <button class="btn btn-primary" type="button" :disabled="testing" @click="onTest">
                <span v-if="testing" class="spinner"></span>
                <AppIcon v-else name="bolt" :size="14" />
                测试连通性
              </button>
              <span v-if="testResult" class="test-result" :class="testResult.ok ? 'ok' : 'err'">
                <AppIcon :name="testResult.ok ? 'check' : 'alert'" :size="14" />
                {{ testResult.text }}
              </span>
            </div>
          </div>
        </div>

        <!-- ============ 生成偏好 ============ -->
        <div v-else-if="activeTab === 'generation'" class="modal-body">
          <div class="section">
            <h3>输出形态（固定）</h3>
            <div class="notice info">
              <AppIcon name="check" :size="15" />
              <span>
                固定输出 <strong>单个 Vue 组件</strong>，脚本固定为
                <code>&lt;script setup lang="ts"&gt;</code>（TypeScript）。这两项是产品固定行为，不提供切换，
                以保证生成结果能直接在浏览器中编译加载。
              </span>
            </div>
            <div class="switch-row">
              <label class="switch">
                <input v-model="settingsState.generation.scopedStyle" type="checkbox" />
                <span class="track"></span>
                <span>使用 &lt;style scoped&gt;，避免样式互相污染</span>
              </label>
              <label class="switch">
                <input v-model="settingsState.generation.themeAware" type="checkbox" />
                <span class="track"></span>
                <span>要求适配深色背景（使用 CSS 变量）</span>
              </label>
            </div>
          </div>

          <div class="section">
            <h3>追加到系统提示词的要求</h3>
            <div class="field">
              <textarea
                v-model="settingsState.generation.extraSystemPrompt"
                class="textarea"
                rows="4"
                placeholder="例如：所有组件都使用圆角 16px、主色 #42d392；交互文案使用中文；不要使用渐变背景。"
              ></textarea>
              <span class="hint">每次生成都会把这段要求追加到系统提示词末尾。</span>
            </div>
          </div>

          <div class="section">
            <h3>系统提示词预览</h3>
            <label class="switch">
              <input v-model="showSystemPrompt" type="checkbox" />
              <span class="track"></span>
              <span>展开查看实际发送给模型的要求</span>
            </label>
            <pre v-if="showSystemPrompt" class="prompt-preview mono">{{ systemPromptPreview }}</pre>
          </div>
        </div>

        <!-- ============ 预览与界面 ============ -->
        <div v-else class="modal-body">
          <div class="section">
            <h3>实时加载</h3>
            <div class="switch-row">
              <label class="switch">
                <input v-model="settingsState.ui.autoReload" type="checkbox" />
                <span class="track"></span>
                <span>生成过程中自动编译并加载（推荐）</span>
              </label>
              <label class="switch">
                <input v-model="settingsState.ui.captureConsole" type="checkbox" />
                <span class="track"></span>
                <span>采集组件内的 console 输出与运行期错误</span>
              </label>
              <label class="switch">
                <input v-model="settingsState.ui.allowRemoteImports" type="checkbox" />
                <span class="track"></span>
                <span>允许加载 http(s) 远程 ESM 模块（如 CDN 上的工具库）</span>
              </label>
            </div>
            <div class="field narrow">
              <label>自动加载延迟（毫秒）</label>
              <input
                class="input"
                type="number"
                min="0"
                max="5000"
                step="100"
                :value="settingsState.ui.reloadDelay"
                @input="settingsState.ui.reloadDelay = clamp(Number(($event.target as HTMLInputElement).value), 0, 5000)"
              />
              <span class="hint">数值越大，流式生成时编译次数越少；设为 0 则每次代码变化立即编译。</span>
            </div>
          </div>

          <div class="section">
            <h3>样式隔离</h3>
            <div class="field">
              <select v-model="settingsState.ui.isolation" class="select">
                <option value="shadow">Shadow DOM 隔离（推荐，组件样式不会影响本页面）</option>
                <option value="none">直接挂载（组件全局样式会作用到本页面）</option>
              </select>
              <span class="hint">
                两种模式都是把组件挂载到当前页面里运行；Shadow DOM 模式兼容性更好，但无法使用
                <code>Teleport to="body"</code> 之类的跨边界操作。
              </span>
            </div>
          </div>

          <div class="section">
            <h3>界面</h3>
            <div class="grid-2">
              <div class="field">
                <label>主题</label>
                <select v-model="settingsState.ui.theme" class="select">
                  <option value="dark">深色</option>
                  <option value="light">浅色</option>
                </select>
              </div>
              <div class="field">
                <label>思考过程（DeepSeek R1 等）</label>
                <select v-model="settingsState.ui.showReasoning" class="select">
                  <option :value="false">默认折叠</option>
                  <option :value="true">默认展开</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <footer class="modal-foot">
          <span class="muted">所有设置即时生效并保存在本机浏览器。</span>
          <div class="grow"></div>
          <button class="btn btn-ghost" type="button" @click="onReset">恢复默认</button>
          <button class="btn btn-primary" type="button" @click="visible = false">完成</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.settings-modal {
  width: min(1000px, 100%);
  height: min(760px, 88vh);
}
.modal-head strong {
  font-size: 14px;
}
.modal-head .tabs {
  margin-left: 8px;
}
.modal-head .btn-icon {
  margin-left: auto;
}
.platform-body {
  display: flex;
  gap: 16px;
  padding: 0;
  overflow: hidden;
}
.profile-list {
  width: 236px;
  flex: none;
  border-right: 1px solid var(--border);
  background: var(--bg-0);
  display: flex;
  flex-direction: column;
  padding: 10px;
  gap: 4px;
  overflow-y: auto;
}
.profile-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 4px 8px;
}
.profile-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: var(--text-1);
  transition: all 0.16s;
}
.profile-item:hover {
  background: var(--bg-2);
}
.profile-item.active {
  background: var(--accent-soft);
  border-color: var(--accent-line);
  color: var(--text-0);
}
.p-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-2);
  flex: none;
}
.p-dot.on {
  background: var(--accent);
}
.p-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 1px;
  font-size: 12.5px;
}
.p-info small {
  color: var(--text-2);
  font-size: 11px;
}
.profile-list-foot {
  margin-top: auto;
  display: flex;
  gap: 4px;
  padding-top: 8px;
}
.profile-form {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 16px 18px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.range {
  width: 100%;
  accent-color: var(--accent);
}
.proxy-switch {
  align-items: flex-start;
  padding: 11px 13px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-2);
}
.proxy-switch .track {
  margin-top: 2px;
}
.proxy-switch small {
  font-size: 11.5px;
}
.test-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 4px;
}
.test-result {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
}
.test-result.ok {
  color: var(--accent);
}
.test-result.err {
  color: var(--danger);
  max-width: 100%;
}
.section {
  margin-bottom: 20px;
}
.section h3 {
  font-size: 12.5px;
  color: var(--text-1);
  margin-bottom: 10px;
  letter-spacing: 0.3px;
}
.switch-row {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 12px;
}
.field.narrow {
  max-width: 320px;
  margin-top: 14px;
}
.preset-note {
  color: var(--accent-2);
  border-left: 2px solid color-mix(in srgb, var(--accent-2) 45%, transparent);
  padding-left: 8px;
}
.prompt-preview {  margin: 0;
  font-size: 11.5px;
  color: var(--text-2);
  background: var(--bg-0);
  padding: 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  white-space: pre-wrap;
}
@media (max-width: 760px) {
  .grid-2 {
    grid-template-columns: 1fr;
  }
  .profile-list {
    width: 180px;
  }
}
</style>
