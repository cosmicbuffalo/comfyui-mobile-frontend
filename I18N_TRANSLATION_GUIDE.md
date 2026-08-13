# ComfyUI Mobile — i18n 翻译指南（子代理工作规范）

本仓库正在引入 i18n 系统（`src/i18n/`）。你的任务：**把你负责的文件里的用户可见英文界面文字用 `t()` 包裹，并输出一份英文→简体中文的词典 JSON**。**不要修改任何测试文件**（测试由后续阶段统一处理）。

## 1. API 用法

**组件文件（.tsx）**：

```tsx
import { useT } from '@/i18n';

export function MyComponent() {
  const t = useT(); // 在组件函数体内调用
  return <button title={t('Close')}>{t('Run')}</button>;
}
```

**非组件模块（.ts，如 utils/hooks/api）**：

```ts
import { t } from '@/i18n';
const msg = t('Failed to load workflow');
```

带占位符的插值字符串：

```tsx
t('{count} nodes', { count: totalNodes })   // 词典键是带 {count} 的原文
```

`t()` 在语言为英文时原样返回 key，所以 key **必须与源英文文字逐字一致**。

## 2. 需要包裹的字符串（全部用户可见文字）

- JSX 文本节点：`<span>Queue</span>` → `<span>{t('Queue')}</span>`
- 属性：`title=`、`aria-label=`、`placeholder=`、`alt=` 中的文字
- 组件 props 中的文案：选项 label/description、错误提示、确认弹窗标题与描述、按钮文字
- `setError(...)`、`setMessage(...)`、`toast` 等**会显示给用户**的消息字符串
- 事件回调里给用户看的字符串
- 组件顶部常量数组里的 label/description 等显示文字
- 三元表达式/模板字符串里的用户可见文字片段（模板串整体作为 key，如 `` `Node ${id}` `` → `t('Node {id}', { id })`）
- 条件拼接的可见文字，例如 `${n} nodes`、`[Unsaved]`、`(2 hidden)`

## 3. 绝对不要包裹（保持原样）

- **所有与自定义节点（custom nodes）相关的界面文字，保持英文**。已知清单：
  - 'Custom nodes'、'Custom node' 相关文案
  - 'Search custom nodes'、'Filter custom nodes'、'Loading custom nodes…'、'No custom nodes match this view.'
  - 'Switch ver'、'Try update'、'Switch version'、'Missing'、'Installed'、'Update available' 等自定义节点管理器里的筛选标签
  - 'Custom node task completed. Restart ComfyUI to apply changes.'、'Custom node installed. Restart ComfyUI to apply changes.'
  - 'This workflow uses custom nodes you haven&apos;t installed yet.' 及其变体
  - "This custom node isn't installed on the server:"
  - 'Missing Node'、'Install missing node'、'Install missing nodes'、'Dismiss'
  - 文件 `CustomNodesManagerModal.tsx`、`src/data/customNodeNotes.ts`、`src/utils/customNodesManager.ts`、`src/utils/customNodesManagerCache.ts`、`src/components/modals/MissingNodesDialog.tsx` **整文件跳过**（MissingNodesDialog 整个是缺失自定义节点对话框）
- 代码标识符：变量名、对象键、枚举值、存储键名、localStorage 键、事件名、CSS 类名
- 逻辑判断用字符串：`if (x === 'success')`、switch 分支、数组索引、排序/筛选用的 value（只包 label）
- `console.*` 调试日志（开发者可见，不属界面）
- API 路径、文件名、文件格式扩展名（.json、.png）
- 品牌名：ComfyUI、LoRA、TAESD、PyTorch、Python、GPU、VRAM、RAM、CPU（标签 "CPU"/"VRAM"/"System RAM" 可以翻译成 中文？→ 保持 "CPU"/"VRAM" 缩写，'System RAM' 译为 '系统内存'，'VRAM' 保持）
- 来自服务器的数据：节点标题、节点类型名、模型名、文件名、子图名、报错详情里的服务端原文
- 单位与数值：'B'、'MB'、'GB'、'ms'、'%' 等
- 键盘快捷键文字（如 'Q'）、日期时间格式化选项
- 正则表达式、模板字符串中属于数据/路径的部分

## 4. 词典 JSON 输出

为每个你负责的组创建一个文件：`translations-out/<组名>.json`，格式为单个 JSON 对象：

```json
{
  "Queue": "队列",
  "Run": "运行",
  "{count} nodes": "{count} 个节点",
  "Queueing...": "排队中…"
}
```

要求：
- **key 必须与你实际包裹的源文字逐字一致**（含大小写、标点、省略号 … 或 ...、引号样式）。只收录你确实包裹了的字符串。
- 占位符 `{name}` 在 value 中必须原样保留。
- 只写简体中文，自然、简洁、符合移动端 UI 习惯。
- 你组内出现的同一英文词，译文保持一致。

## 5. 常用术语对照（供统一风格）

| 英文 | 中文 |
|---|---|
| Queue | 队列 |
| Run / Generate | 运行 / 生成 |
| Cancel | 取消 |
| Close | 关闭 |
| Save / Load | 保存 / 加载 |
| Workflow | 工作流 |
| Outputs / Inputs | 输出 / 输入 |
| Preferences | 偏好设置 |
| Server | 服务器 |
| Restart | 重启 |
| Loading... / Loading | 加载中… / 加载中 |
| Search | 搜索 |
| Filter | 筛选 |
| Delete | 删除 |
| Download | 下载 |
| Copy / Paste | 复制 / 粘贴 |
| Folder / File | 文件夹 / 文件 |
| History | 历史记录 |
| Untitled | 未命名 |
| Queueing... | 排队中… |
| Executing / Running | 执行中 / 运行中 |
| Failed to ... | 无法…… |
| Missing | 缺失 |
| Notifications | 通知 |
| Settings | 设置 |
| Fast / Accurate | 快速 / 精确 |
| nodes | 节点 |
| hidden | 已隐藏 |
| Unsaved | 未保存 |

## 6. 完成标准

- 你负责的每个源文件里，所有用户可见英文都已用 `t()` 包裹（自定义节点相关除外）。
- 语法完整：TSX 结构、引号、花括号正确；字符串拼接处仍返回 string。
- 不要改动逻辑、类名、接口、props。
- 不要修改测试文件、不要运行构建。
- 写好转译 JSON 后，在最终回复中列出：处理了哪些文件、新增了多少个词典条目、任何存疑/跳过的字符串。
