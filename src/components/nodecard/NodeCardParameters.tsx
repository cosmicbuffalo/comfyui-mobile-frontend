import { WidgetControl } from '../WidgetControl';
import { NumberControl } from '../widget/NumberControl';
import type { WorkflowNode } from '@/api/types';
import {
  generateSeedFromNode,
  getSpecialSeedMode,
  isSpecialSeedValue,
  useWorkflowStore
} from '@/hooks/useWorkflow';

interface WidgetDescriptor {
  widgetIndex: number;
  name: string;
  type: string;
  value: unknown;
  options?: Record<string, unknown> | unknown[];
  connected?: boolean;
}

interface NodeCardParametersProps {
  node: WorkflowNode;
  isBypassed: boolean;
  isKSampler: boolean;
  workflowExists: boolean;
  nodeTypesExists: boolean;
  visibleInputWidgets: WidgetDescriptor[];
  visibleWidgets: WidgetDescriptor[];
  errorInputNames: Set<string>;
  onUpdateNodeWidget: (nodeId: number, widgetIndex: number, value: unknown, widgetName?: string) => void;
  onUpdateNodeWidgets: (nodeId: number, updates: Record<number, unknown>) => void;
  getWidgetIndexForInput: (name: string) => number | null;
  findSeedWidgetIndex: () => number | null;
  setSeedMode: (nodeId: number, mode: 'fixed' | 'randomize' | 'increment' | 'decrement') => void;
  isWidgetBookmarked: (widgetIndex: number) => boolean;
  toggleWidgetBookmark: (widgetIndex: number, widgetName: string, widgetType: string, options?: Record<string, unknown> | unknown[]) => void;
}

export function NodeCardParameters({
  node,
  isBypassed,
  isKSampler,
  workflowExists,
  nodeTypesExists,
  visibleInputWidgets,
  visibleWidgets,
  errorInputNames,
  onUpdateNodeWidget,
  onUpdateNodeWidgets,
  getWidgetIndexForInput,
  findSeedWidgetIndex,
  setSeedMode,
  isWidgetBookmarked,
  toggleWidgetBookmark
}: NodeCardParametersProps) {
  const widgetValues = Array.isArray(node.widgets_values) ? node.widgets_values : [];
  const nodeTypes = useWorkflowStore((state) => state.nodeTypes);
  const storedSeedMode = useWorkflowStore((state) => state.seedModes[node.id]);
  const lastSeedValue = useWorkflowStore((state) => state.seedLastValues[node.id] ?? null);
  const seedWidgetIndex = !isKSampler && workflowExists && nodeTypesExists
    ? findSeedWidgetIndex()
    : null;
  const seedControlIndex = seedWidgetIndex !== null ? seedWidgetIndex + 1 : null;
  const seedControlValue = seedControlIndex !== null ? widgetValues[seedControlIndex] : undefined;
  const hasSeedControlWidget = typeof seedControlValue === 'string';
  const hideSeedInputWidget = !isKSampler && seedWidgetIndex !== null && !hasSeedControlWidget;
  const inputWidgetsToRender = hideSeedInputWidget
    ? visibleInputWidgets.filter((widget) => widget.name !== 'seed' && widget.name !== 'noise_seed')
    : visibleInputWidgets;
  const widgetsToRender = hideSeedInputWidget
    ? visibleWidgets.filter((widget) => widget.name !== 'seed' && widget.name !== 'noise_seed')
    : visibleWidgets;
  if (visibleWidgets.length === 0 && visibleInputWidgets.length === 0) return null;

  return (
    <div className="mb-3">
      <div className="text-xs text-gray-500 mb-1.5 uppercase tracking-wide">
        Parameters
      </div>
      {isKSampler && workflowExists && nodeTypesExists && (() => {
        const seedIndex = getWidgetIndexForInput('seed');
        if (seedIndex === null) return null;
        const seedValue = widgetValues[seedIndex];
        const seedControlIndex = seedIndex + 1;
        const seedControlValue = widgetValues[seedControlIndex];
        const seedControlChoices = ['fixed', 'increment', 'decrement', 'randomize'];
        const noiseSeedInput = node.inputs.find((input) => input.name === 'noise_seed');
        const hideSeedControl = Boolean(noiseSeedInput?.link);

        return (
          <div className="mb-3">
            <WidgetControl
              name="seed"
              type="INT"
              value={seedValue}
              onChange={(newValue) => onUpdateNodeWidget(node.id, seedIndex, newValue, 'seed')}
              disabled={isBypassed}
              hasError={errorInputNames.has('seed')}
            />
            {seedControlIndex < widgetValues.length && !hideSeedControl && (
              <WidgetControl
                name="Control mode"
                type="COMBO"
                value={seedControlValue}
                options={seedControlChoices}
                onChange={(newValue) => {
                  onUpdateNodeWidget(node.id, seedControlIndex, newValue);
                  const validModes = ['fixed', 'randomize', 'increment', 'decrement'];
                  if (typeof newValue === 'string' && validModes.includes(newValue)) {
                    setSeedMode(node.id, newValue as 'fixed' | 'randomize' | 'increment' | 'decrement');
                  }
                }}
              />
            )}
          </div>
        );
      })()}
      {!isKSampler && workflowExists && nodeTypesExists && (() => {
        const seedIndex = seedWidgetIndex;
        if (seedIndex === null) return null;
        const baseChoices = ['fixed', 'randomize', 'increment', 'decrement'];
        const choices = typeof seedControlValue === 'string' && !baseChoices.includes(seedControlValue)
          ? [...baseChoices, seedControlValue]
          : baseChoices;
        const seedInputEntry = node.inputs.find(
          (input) => input.name === 'seed' || input.name === 'noise_seed'
        );
        if (seedInputEntry?.link != null) return null;

        if (hasSeedControlWidget) {
          const controlIndex = seedIndex + 1;
          return (
            <div className="mb-3">
              <WidgetControl
                name="Seed control"
                type="COMBO"
                value={seedControlValue}
                options={choices}
                onChange={(newValue) => {
                  onUpdateNodeWidget(node.id, controlIndex, newValue);
                  const validModes = ['fixed', 'randomize', 'increment', 'decrement'];
                  if (typeof newValue === 'string' && validModes.includes(newValue)) {
                    setSeedMode(node.id, newValue as 'fixed' | 'randomize' | 'increment' | 'decrement');
                  }
                }}
              />
            </div>
          );
        }

        const seedWidget = visibleInputWidgets.find((widget) =>
          widget.name === 'seed' || widget.name === 'noise_seed'
        );
        const seedOptions = (seedWidget?.options ?? {}) as Record<string, unknown>;
        const min = typeof seedOptions.min === 'number' ? seedOptions.min : undefined;
        const max = typeof seedOptions.max === 'number' ? seedOptions.max : undefined;
        const step = typeof seedOptions.step === 'number' ? seedOptions.step : undefined;
        const rawSeedValue = Number(widgetValues[seedIndex] ?? 0);
        const specialMode = getSpecialSeedMode(rawSeedValue);
        const seedMode = storedSeedMode ?? specialMode ?? 'fixed';
        const displaySeedValue = isSpecialSeedValue(rawSeedValue)
          ? (typeof lastSeedValue === 'number' ? lastSeedValue : 0)
          : rawSeedValue;
        const hasSeedError = errorInputNames.has('seed') || errorInputNames.has('noise_seed');

        return (
          <div className="mb-3">
            <NumberControl
              containerClass="mb-3"
              name="seed"
              value={displaySeedValue}
              onChange={(newValue) => {
                onUpdateNodeWidget(node.id, seedIndex, newValue, 'seed');
                setSeedMode(node.id, 'fixed');
              }}
              disabled={isBypassed}
              hasBookmark={false}
              isInt
              min={min}
              max={max}
              step={step}
              hasError={hasSeedError}
            />
            <WidgetControl
              name="Seed control"
              type="COMBO"
              value={seedMode}
              options={baseChoices}
              onChange={(newValue) => {
                const validModes = ['fixed', 'randomize', 'increment', 'decrement'];
                if (typeof newValue === 'string' && validModes.includes(newValue)) {
                  setSeedMode(node.id, newValue as 'fixed' | 'randomize' | 'increment' | 'decrement');
                }
              }}
            />
            <div className="grid gap-2 mt-2">
              <button
                type="button"
                className="w-full py-2 px-3 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:text-blue-600 hover:border-blue-500 transition"
                onClick={() => setSeedMode(node.id, 'randomize')}
                disabled={isBypassed}
              >
                Randomize each time
              </button>
              <button
                type="button"
                className="w-full py-2 px-3 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:text-blue-600 hover:border-blue-500 transition"
                onClick={() => {
                  if (!nodeTypes) return;
                  const nextSeed = generateSeedFromNode(nodeTypes, node);
                  onUpdateNodeWidget(node.id, seedIndex, nextSeed, 'seed');
                  setSeedMode(node.id, 'fixed');
                }}
                disabled={isBypassed}
              >
                New fixed random
              </button>
              <button
                type="button"
                className="w-full py-2 px-3 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:text-blue-600 hover:border-blue-500 transition"
                onClick={() => {
                  if (typeof lastSeedValue !== 'number') return;
                  onUpdateNodeWidget(node.id, seedIndex, lastSeedValue, 'seed');
                  setSeedMode(node.id, 'fixed');
                }}
                disabled={isBypassed || typeof lastSeedValue !== 'number'}
              >
                Use last queued seed
              </button>
            </div>
          </div>
        );
      })()}
      {inputWidgetsToRender.map((inputWidget) => (
        <div key={`input-widget-${inputWidget.name}`} className={isBypassed ? 'opacity-80' : ''}>
          <WidgetControl
            name={inputWidget.name}
            type={inputWidget.type}
            value={inputWidget.value}
            options={inputWidget.options}
            onChange={(newValue) => {
              onUpdateNodeWidget(node.id, inputWidget.widgetIndex, newValue, inputWidget.name);
            }}
            disabled={isBypassed}
            isBookmarked={isWidgetBookmarked(inputWidget.widgetIndex)}
            onToggleBookmark={() => toggleWidgetBookmark(inputWidget.widgetIndex, inputWidget.name, inputWidget.type, inputWidget.options)}
            hasError={errorInputNames.has(inputWidget.name)}
          />
        </div>
      ))}
      {widgetsToRender.map((widget) => (
        <div key={`widget-${widget.widgetIndex}`} className={isBypassed ? 'opacity-80' : ''}>
          <WidgetControl
            name={widget.name}
            type={widget.type}
            value={widget.value}
            options={widget.options}
            onChange={(newValue) => {
              if (widget.type === 'POWER_LORA_HEADER' && typeof newValue === 'boolean') {
                const { loraIndices } = (widget.options || {}) as { loraIndices: number[] };
                if (loraIndices) {
                  const updates: Record<number, unknown> = {};
                  const widgetValues = node.widgets_values;
                  if (Array.isArray(widgetValues)) {
                    loraIndices.forEach((idx) => {
                      const currentVal = widgetValues[idx] as Record<string, unknown>;
                      updates[idx] = { ...currentVal, on: newValue };
                    });
                    onUpdateNodeWidgets(node.id, updates);
                  }
                }
              } else {
                onUpdateNodeWidget(node.id, widget.widgetIndex, newValue, widget.name);
              }
            }}
            disabled={isBypassed}
            isBookmarked={isWidgetBookmarked(widget.widgetIndex)}
            onToggleBookmark={() => toggleWidgetBookmark(widget.widgetIndex, widget.name, widget.type, widget.options)}
            hasError={errorInputNames.has(widget.name)}
          />
        </div>
      ))}
      {node.type === 'PrimitiveNode' && (() => {
        const outputType = node.outputs?.[0]?.type;
        const normalizedType = String(outputType).toUpperCase();
        if (normalizedType !== 'INT' && normalizedType !== 'FLOAT') return null;
        if (widgetValues.length < 2) return null;
        const controlValue = widgetValues[1];
        const controlChoices = ['fixed', 'increment', 'decrement', 'randomize'];
        return (
          <div className="mb-3">
            <WidgetControl
              name="Control mode"
              type="COMBO"
              value={controlValue}
              options={controlChoices}
              onChange={(newValue) => onUpdateNodeWidget(node.id, 1, newValue)}
              disabled={isBypassed}
            />
          </div>
        );
      })()}
    </div>
  );
}
