import { useState } from 'react';
import { Dialog } from './Dialog';
import { useI18n } from '@/i18n';

export type SubgraphLabelTarget =
  | { kind: 'slot'; direction: 'input' | 'output'; slotName: string }
  | { kind: 'proxy'; innerNodeId: number; widgetName: string };

export interface SubgraphLabelRow {
  key: string;
  target: SubgraphLabelTarget;
  /** The label template stored on the DEFINITION ('' when none is set). */
  template: string;
  /** This instance's own override ('' when it defers to the type). */
  instanceTemplate: string;
  /** What the row shows with neither set — used as the input placeholder. */
  defaultLabel: string;
}

export type SubgraphLabelScope = 'definition' | 'instance';

interface EditSubgraphLabelsModalProps {
  subgraphName: string;
  rows: SubgraphLabelRow[];
  /** How many placeholders share this definition, including this one. */
  instanceCount: number;
  onSave: (
    changes: Array<{ target: SubgraphLabelTarget; label: string }>,
    scope: SubgraphLabelScope,
  ) => void;
  onCancel: () => void;
}

/**
 * Label editor for a subgraph's promoted widgets and boundary slots, opened
 * from the placeholder card.
 *
 * Labels live at two levels — the definition's, shared by every instance of the
 * type, and this placeholder's own override. The editor edits one level at a
 * time, because a name means something different at each: with several
 * instances it asks which, and starts on whichever level the labels currently
 * come from, so opening and saving never moves a name between levels. `{n}`
 * renders as the instance's number at either level.
 */
export function EditSubgraphLabelsModal({
  subgraphName,
  rows,
  instanceCount,
  onSave,
  onCancel,
}: EditSubgraphLabelsModalProps) {
  const { t } = useI18n();
  const hasInstanceOverrides = rows.some((row) => row.instanceTemplate);
  const [scope, setScope] = useState<SubgraphLabelScope>(
    hasInstanceOverrides ? 'instance' : 'definition',
  );
  const stored = (row: SubgraphLabelRow, forScope: SubgraphLabelScope) =>
    forScope === 'instance' ? row.instanceTemplate : row.template;

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      rows.map((row) => [
        row.key,
        stored(row, hasInstanceOverrides ? 'instance' : 'definition'),
      ]),
    ),
  );

  const handleScopeChange = (next: SubgraphLabelScope) => {
    setScope(next);
    setValues(Object.fromEntries(rows.map((row) => [row.key, stored(row, next)])));
  };

  const handleSave = () => {
    const changes = rows
      .filter((row) => (values[row.key] ?? '') !== stored(row, scope))
      .map((row) => ({ target: row.target, label: (values[row.key] ?? '').trim() }));
    onSave(changes, scope);
  };

  return (
    <Dialog
      onClose={onCancel}
      title={t('Edit widget labels')}
      size="md"
      description={
        <div className="subgraph-label-editor mt-2 flex flex-col gap-3">
          {instanceCount > 1 ? (
            <div className="subgraph-label-scope flex flex-col gap-1.5">
              <span className="text-xs text-slate-400">
                {t('{name} has {count} instances. Apply these names to:', {
                  name: subgraphName,
                  count: instanceCount,
                })}
              </span>
              <div className="flex gap-2">
                {(
                  [
                    ['instance', t('This instance')],
                    ['definition', t('All instances')],
                  ] as Array<[SubgraphLabelScope, string]>
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    data-scope={key}
                    aria-pressed={scope === key}
                    className={`subgraph-label-scope-option flex-1 rounded-lg border px-3 py-2 text-sm ${
                      scope === key
                        ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200'
                        : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                    }`}
                    onClick={() => handleScopeChange(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-400">
              {t('Labels apply to every instance of {name}. Use {token} for the instance number.', {
                name: subgraphName,
                token: '{n}',
              })}
            </div>
          )}

          {rows.map((row) => {
            // While editing the type's labels, a row this instance overrides is
            // worth flagging: the name typed here is not the one it will show.
            const shadowed = scope === 'definition' && Boolean(row.instanceTemplate);
            return (
              <label key={row.key} className="subgraph-label-row flex flex-col gap-1">
                <span className="text-xs text-slate-400">
                  {row.defaultLabel}
                  {shadowed && (
                    <span className="subgraph-label-shadowed ml-1.5 text-fuchsia-400">
                      {t('overridden here as “{label}”', { label: row.instanceTemplate })}
                    </span>
                  )}
                </span>
                <input
                  type="text"
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                  value={values[row.key] ?? ''}
                  placeholder={row.template || row.defaultLabel}
                  data-swipe-nav-ignore
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [row.key]: event.target.value }))
                  }
                />
              </label>
            );
          })}
        </div>
      }
      actions={[
        { label: t('Cancel'), onClick: onCancel, variant: 'secondary' },
        { label: t('Save'), onClick: handleSave, variant: 'primary' },
      ]}
    />
  );
}
