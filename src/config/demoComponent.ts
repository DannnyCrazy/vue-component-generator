/**
 * 内置演示组件：不调用任何 AI 接口，用于验证「生成 → 实时加载」链路是否正常。
 * 这段代码同时也是「允许 AI 输出什么」的参考范本：单个 SFC、只依赖 vue、自包含数据。
 */
export const DEMO_COMPONENT = `<template>
  <section class="task-board">
    <header class="board-head">
      <div>
        <h2>今日任务</h2>
        <p class="sub">{{ doneCount }} / {{ tasks.length }} 已完成 · 内置演示组件</p>
      </div>
      <div class="progress" role="progressbar" :aria-valuenow="percent">
        <span :style="{ width: percent + '%' }"></span>
      </div>
    </header>

    <form class="composer" @submit.prevent="addTask">
      <input v-model="draft" placeholder="输入任务后回车添加…" />
      <button type="submit" :disabled="!draft.trim()">添加</button>
    </form>

    <div class="filters">
      <button
        v-for="tab in tabs"
        :key="tab.value"
        :class="{ active: filter === tab.value }"
        @click="filter = tab.value"
      >
        {{ tab.label }}
        <em>{{ countOf(tab.value) }}</em>
      </button>
    </div>

    <transition-group name="list" tag="ul" class="task-list">
      <li v-for="task in visibleTasks" :key="task.id" :class="{ done: task.done }">
        <label class="check">
          <input type="checkbox" :checked="task.done" @change="toggle(task)" />
          <span class="box" aria-hidden="true"></span>
        </label>
        <span class="title">{{ task.title }}</span>
        <span class="tag" :class="'p' + task.priority">{{ priorityLabel(task.priority) }}</span>
        <button class="del" title="删除" @click="remove(task)">✕</button>
      </li>
    </transition-group>

    <p v-if="!visibleTasks.length" class="empty">这里空空如也，先添加一个任务吧 ✨</p>

    <footer v-if="doneCount" class="board-foot">
      <button class="clear" @click="clearDone">清除已完成（{{ doneCount }}）</button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

interface Task {
  id: number
  title: string
  done: boolean
  priority: number
}

interface FilterTab {
  label: string
  value: FilterValue
}

type FilterValue = 'all' | 'active' | 'done'

const tabs: FilterTab[] = [
  { label: '全部', value: 'all' },
  { label: '进行中', value: 'active' },
  { label: '已完成', value: 'done' },
]

let seed = 5
const draft = ref<string>('')
const filter = ref<FilterValue>('all')
const tasks = ref<Task[]>([
  { id: 1, title: '设计组件库的暗色主题变量', done: true, priority: 2 },
  { id: 2, title: '实现实时预览的沙箱隔离', done: false, priority: 3 },
  { id: 3, title: '补充 AI 平台的错误提示文案', done: false, priority: 1 },
  { id: 4, title: '整理一份接入自定义平台的文档', done: false, priority: 2 },
])

const doneCount = computed<number>(() => tasks.value.filter((t) => t.done).length)
const percent = computed<number>(() =>
  tasks.value.length ? Math.round((doneCount.value / tasks.value.length) * 100) : 0,
)
const visibleTasks = computed<Task[]>(() => {
  if (filter.value === 'active') return tasks.value.filter((t) => !t.done)
  if (filter.value === 'done') return tasks.value.filter((t) => t.done)
  return tasks.value
})

function countOf(value: FilterValue): number {
  if (value === 'active') return tasks.value.filter((t) => !t.done).length
  if (value === 'done') return doneCount.value
  return tasks.value.length
}

function priorityLabel(priority: number): string {
  return ['低', '中', '高'][priority - 1] ?? '中'
}

function addTask(): void {
  const title = draft.value.trim()
  if (!title) return
  tasks.value.unshift({ id: ++seed, title, done: false, priority: 2 })
  draft.value = ''
}

function toggle(task: Task): void {
  task.done = !task.done
}

function remove(task: Task): void {
  tasks.value = tasks.value.filter((t) => t.id !== task.id)
}

function clearDone(): void {
  tasks.value = tasks.value.filter((t) => !t.done)
}
</script>

<style scoped>
.task-board {
  width: 100%;
  box-sizing: border-box;
  padding: 22px;
  border-radius: 18px;
  background: linear-gradient(160deg, #161f2b, #101821);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e6eef7;
  font-family: inherit;
  box-shadow: 0 24px 60px -32px rgba(0, 0, 0, 0.9);
}
.board-head {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: center;
  justify-content: space-between;
}
h2 {
  margin: 0;
  font-size: 19px;
  letter-spacing: 0.5px;
}
.sub {
  margin: 6px 0 0;
  font-size: 12px;
  color: #8ea3b7;
}
.progress {
  flex: 1 1 160px;
  max-width: 220px;
  height: 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}
.progress span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #42d392, #647eff);
  transition: width 0.35s ease;
}
.composer {
  display: flex;
  gap: 8px;
  margin: 18px 0 14px;
}
.composer input {
  flex: 1;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.composer input:focus {
  border-color: #42d392;
  box-shadow: 0 0 0 3px rgba(66, 211, 146, 0.16);
}
.composer button {
  padding: 10px 18px;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, #42d392, #2fb37c);
  color: #06231a;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.15s, filter 0.15s;
}
.composer button:hover:not(:disabled) {
  filter: brightness(1.08);
  transform: translateY(-1px);
}
.composer button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.filters {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}
.filters button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.05);
  color: #9db0c2;
  font-size: 12.5px;
  cursor: pointer;
  transition: all 0.2s;
}
.filters button.active {
  background: rgba(66, 211, 146, 0.14);
  border-color: rgba(66, 211, 146, 0.45);
  color: #6ff0b4;
}
.filters em {
  font-style: normal;
  font-size: 11px;
  opacity: 0.75;
}
.task-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.task-list li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.05);
  transition: transform 0.18s, background 0.18s, opacity 0.3s;
}
.task-list li:hover {
  background: rgba(255, 255, 255, 0.07);
  transform: translateX(2px);
}
.task-list li.done .title {
  text-decoration: line-through;
  color: #6d8091;
}
.check {
  position: relative;
  display: inline-flex;
  cursor: pointer;
}
.check input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.box {
  width: 19px;
  height: 19px;
  border-radius: 6px;
  border: 1.6px solid rgba(255, 255, 255, 0.28);
  display: inline-block;
  transition: all 0.2s;
}
.check input:checked + .box {
  background: #42d392;
  border-color: #42d392;
  box-shadow: 0 0 0 3px rgba(66, 211, 146, 0.18);
}
.check input:focus-visible + .box {
  outline: 2px solid #647eff;
  outline-offset: 2px;
}
.title {
  flex: 1;
  font-size: 14px;
}
.tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid transparent;
}
.tag.p1 {
  color: #9db0c2;
  border-color: rgba(157, 176, 194, 0.3);
}
.tag.p2 {
  color: #ffb84d;
  border-color: rgba(255, 184, 77, 0.35);
}
.tag.p3 {
  color: #ff7a8a;
  border-color: rgba(255, 122, 138, 0.35);
}
.del {
  border: none;
  background: transparent;
  color: #6d8091;
  cursor: pointer;
  font-size: 13px;
  padding: 4px 6px;
  border-radius: 8px;
  transition: all 0.18s;
}
.del:hover {
  color: #ff5f6d;
  background: rgba(255, 95, 109, 0.12);
}
.empty {
  text-align: center;
  color: #6d8091;
  font-size: 13px;
  padding: 26px 0;
}
.board-foot {
  margin-top: 14px;
  text-align: right;
}
.clear {
  border: none;
  background: transparent;
  color: #8ea3b7;
  font-size: 12.5px;
  cursor: pointer;
  text-decoration: underline dotted;
}
.clear:hover {
  color: #ff7a8a;
}
.list-enter-active,
.list-leave-active {
  transition: all 0.28s ease;
}
.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
.list-leave-active {
  position: absolute;
}
</style>
`
