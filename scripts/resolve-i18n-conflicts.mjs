// Resolve cross-group translation conflicts by patching the source JSONs.
// Each entry: [file, key, chosenChineseValue]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = join(process.cwd(), 'translations-out');

const patches = [
  ['hooks-a.json', 'Failed to queue prompt', '无法将任务加入队列'],
  ['hooks-c.json', 'Workflow load error: {count} input reference missing options.', '工作流加载错误：{count} 个输入引用了缺失的选项。'],
  ['hooks-c.json', 'Workflow load error: {count} inputs reference missing options.', '工作流加载错误：{count} 个输入引用了缺失的选项。'],
  ['app-root.json', 'Generation', '生成结果'],
  ['input-controls.json', 'Remove pin', '取消固定'],
  ['modals.json', 'Dismiss', '关闭'],
  ['outputs-panel.json', 'Are you sure you want to load this workflow? You have unsaved changes.', '确定要加载此工作流吗？你有未保存的更改。'],
  ['outputs-panel.json', 'Hide Hidden Files', '不显示隐藏文件'],
  ['outputs-panel.json', '{count} selected', '已选 {count} 项'],
  ['input-controls.json', '{count} total match', '共 {count} 个匹配项'],
  ['input-controls.json', '{count} total matches', '共 {count} 个匹配项'],
  ['components-root.json', 'Cancel All Pending', '取消所有排队任务'],
  ['queue-panel.json', 'Clear Empty Items', '清除空项目'],
  ['components-root.json', 'Download batch', '批量下载'],
  ['queue-panel.json', 'Re-enqueue', '重新入队'],
  ['appmenu-main.json', 'Invalid workflow: missing nodes array', '无效的工作流：缺少节点数组'],
  ['workflow-core.json', 'Paste here', '粘贴到这里'],
  ['workflow-core.json', 'Show all hidden nodes', '显示所有隐藏节点'],
  ['workflow-core.json', 'Show hidden nodes', '显示隐藏节点'],
  ['workflow-core.json', 'Unable to save: embedded workflow is unavailable.', '无法保存：内嵌工作流不可用。'],
  ['workflow-nodecard.json', 'Bookmark node', '添加节点书签'],
  ['components-root.json', 'Bypass node', '旁路节点'],
  ['workflow-nodecard.json', 'Convert to Preview Image', '转换为 Preview Image'],
  ['workflow-nodecard.json', 'Convert to Save Image', '转换为 Save Image'],
  ['components-root.json', 'Edit set name', '编辑 Set 名称'],
  ['workflow-nodecard.json', 'Group {id}', '分组 {id}'],
  ['workflow-nodecard.json', 'Remove bookmark', '移除书签'],
];

for (const [file, key, value] of patches) {
  const path = join(outDir, file);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (data[key] === undefined) {
    console.error(`MISSING KEY in ${file}: ${key}`);
    continue;
  }
  data[key] = value;
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`patched ${file}: ${key} -> ${value}`);
}
