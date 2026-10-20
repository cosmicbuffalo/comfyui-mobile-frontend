import { useEffect, useRef, useState } from 'react';
import type { WorkflowNode } from '@/api/types';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { getActiveNodeInputDefinitions } from '@/utils/workflowInputs';
import { getImagePreviewUrl } from '@/api/client';
import { getLinkId, getLinkOriginId, resolveCurrentScope } from '@/utils/canonicalWorkflowOps';
import { splitPathAnnotation } from '@/utils/annotatedPath';
import { CameraViewport, type TransformMode } from './CameraViewport';
import { limit } from './cameraMath';
import { t as translate, useI18n } from '@/i18n';
const toolbarButton = 'min-h-10 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs aria-pressed:border-cyan-400 aria-pressed:text-cyan-200 disabled:opacity-40';

export default function CameraControls({ node, onChange, disabled }: {
  node: WorkflowNode; onChange: (updates: Record<number, unknown>) => void; disabled: boolean;
}) {
  const { t } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const viewport = useRef<CameraViewport | null>(null);
  const latest = useRef({ node, onChange });
  const [error, setError] = useState<string | null>(null);
  const [lookingThrough, setLookingThrough] = useState(false);
  const [gizmos, setGizmos] = useState(true);
  const [transform, setTransform] = useState<TransformMode>('none');
  const nodeTypes = useWorkflowStore(s => s.nodeTypes);
  const workflow = useWorkflowStore(s => s.workflow);
  const scopeStack = useWorkflowStore(s => s.scopeStack);
  useEffect(() => { latest.current = { node, onChange }; }, [node, onChange]);
  const typeDef = nodeTypes?.[node.type];
  const definitions = typeDef ? getActiveNodeInputDefinitions(typeDef, node) : [];
  const inputs = Object.fromEntries(definitions.map(d => [d.qualifiedName, d.value]));
  const inputsKey = JSON.stringify(inputs);
  const isAngle = node.type === 'CameraAngle';
  const mode = inputs.view === 'object' ? 'object' : 'camera';
  const scope = isAngle && workflow ? resolveCurrentScope(scopeStack, workflow) : null;
  const link = scope?.links.find(l => getLinkId(l) === node.inputs.find(i => i.name === 'image')?.link);
  const sourceId = link ? getLinkOriginId(link) : undefined;
  const sourceOutput = useWorkflowStore(s => sourceId !== undefined ? s.nodeOutputs[String(sourceId)]?.[0] : undefined);
  let referenceUrl: string | null = null;
  if (sourceOutput) referenceUrl = getImagePreviewUrl(sourceOutput.filename, sourceOutput.subfolder, sourceOutput.type, sourceOutput.cacheToken);
  else if (scope && sourceId !== undefined) {
    // A LoadImage value is a path in the input folder, possibly in a subfolder.
    const source = scope.nodes.find(n => n.id === sourceId);
    const sourceDef = source && nodeTypes?.[source.type];
    const value = source && sourceDef ? getActiveNodeInputDefinitions(sourceDef, source).find(d => d.name === 'image')?.value : undefined;
    if (typeof value === 'string' && value) {
      const { path, type } = splitPathAnnotation(value);
      const slash = path.lastIndexOf('/');
      referenceUrl = getImagePreviewUrl(path.slice(slash + 1), slash < 0 ? '' : path.slice(0, slash), type ?? 'input');
    }
  }

  useEffect(() => {
    if (!container.current) return;
    // The viewport redraws on every pointer move; the workflow store takes at
    // most one write per frame, since each write replaces the whole workflow.
    let pending: Record<string, unknown> | null = null;
    let frame = 0;
    const flush = () => {
      frame = 0;
      const values = pending;
      pending = null;
      const current = latest.current;
      const definition = useWorkflowStore.getState().nodeTypes?.[current.node.type];
      if (!values || !definition) return;
      const updates: Record<number, unknown> = {};
      for (const input of getActiveNodeInputDefinitions(definition, current.node)) {
        if (input.widgetIndex === null || input.connected || !(input.qualifiedName in values)) continue;
        const value = values[input.qualifiedName];
        const options = input.inputDef[1];
        // Gestures are unbounded; keep written values inside the backend's declared range.
        updates[input.widgetIndex] = typeof value === 'number' ? limit(value, Number(options?.min ?? -Infinity), Number(options?.max ?? Infinity)) : value;
      }
      if (Object.keys(updates).length) current.onChange(updates);
    };
    const write = (values: Record<string, unknown>) => {
      pending = { ...pending, ...values };
      frame ||= requestAnimationFrame(flush);
    };
    try {
      const instance = new CameraViewport(container.current, isAngle ? 'angle' : 'info', write);
      viewport.current = instance;
      return () => {
        cancelAnimationFrame(frame);
        flush();
        viewport.current = null;
        instance.remove();
      };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : translate('Unable to create 3D preview'));
    }
  }, [isAngle]);

  useEffect(() => {
    const instance = viewport.current;
    instance?.updateInputs(JSON.parse(inputsKey));
    if (isAngle) instance?.setViewMode(mode);
  }, [inputsKey, isAngle, mode]);
  useEffect(() => {
    const instance = viewport.current;
    if (isAngle) void instance?.setImage(referenceUrl);
  }, [referenceUrl, isAngle]);
  const changeMode = (value: string) => {
    const input = definitions.find(d => d.name === 'view');
    if (input?.widgetIndex != null) onChange({ [input.widgetIndex]: value });
  };

  return <section className="my-3 space-y-2" aria-label={isAngle ? t('Camera angle preview') : t('Camera info preview')}>
    <div className="flex flex-wrap gap-2">
      {isAngle ? <>
        <button type="button" className={toolbarButton} aria-pressed={mode === 'camera'} disabled={disabled} onClick={() => changeMode('camera')}>{t('Camera view')}</button>
        <button type="button" className={toolbarButton} aria-pressed={mode === 'object'} disabled={disabled} onClick={() => changeMode('object')}>{t('Object view')}</button>
      </> : <>
        <button type="button" className={toolbarButton} aria-pressed={lookingThrough} onClick={() => { const next = !lookingThrough; setLookingThrough(next); viewport.current?.setLookThrough(next); }}>{t('Look through')}</button>
        <button type="button" className={toolbarButton} aria-pressed={gizmos} disabled={disabled} onClick={() => { setGizmos(!gizmos); viewport.current?.setGizmosVisible(!gizmos); }}>{t('Handles')}</button>
        <select aria-label={t('Camera transform')} className="rounded bg-slate-800 px-2" value={transform} disabled={disabled} onChange={event => { const next = event.target.value as TransformMode; setTransform(next); viewport.current?.setTransformGizmoMode(next); }}>
          <option value="none">{t('Orbit / roll')}</option><option value="target">{t('Move target')}</option><option value="camera-translate">{t('Move camera')}</option><option value="camera-rotate">{t('Rotate camera')}</option>
        </select>
      </>}
    </div>
    {error ? <p role="status" className="text-sm text-slate-400">{t('3D preview unavailable: {error}', { error })}</p> : <div ref={container} className="h-72 w-full overflow-hidden rounded-lg" style={{ pointerEvents: disabled ? 'none' : undefined }} />}
  </section>;
}
