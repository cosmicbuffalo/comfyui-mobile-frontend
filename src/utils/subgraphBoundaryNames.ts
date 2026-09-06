import { generateUuid } from '@/utils/duplicateNode';

/**
 * Naming a subgraph boundary slot.
 *
 * Boundary names have to be unique, because too much is keyed by them: the
 * label a slot shows and the widget options it offers are both looked up by
 * finding the definition's slot OF THAT NAME, and a per-instance label override
 * is stored under it. Two slots called `value` mean the second one wears the
 * first one's label and reads the first one's schema.
 *
 * The `_1` suffix is ComfyUI's own convention — a workflow with two VAELoaders
 * promoted gets `vae_name` and `vae_name_1` — so a boundary built here reads
 * the same as one built on the desktop canvas.
 */
export function uniqueBoundaryName(taken: Set<string>, base: string): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let suffix = 1; ; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/**
 * A fresh id for a boundary slot.
 *
 * Stock declares this field `z.string().uuid()`. Its loader does not enforce
 * that — ComfyUI's own `image_joyai_image_edit` template ships slots called
 * `"prompt"` and `"width"` and loads fine — but a non-UUID fails schema
 * validation, and the user gets a "Workflow Validation" alert over a workflow
 * that is otherwise perfectly good.
 *
 * A UUID also removes the only way two slots could end up sharing an id. The
 * readable ids this replaced were derived from the slot's index, so two edits
 * that each landed a slot at the same index minted the same id twice.
 */
export function newBoundarySlotId(taken?: Iterable<string>): string {
  const used = taken ? new Set(taken) : null;
  let id = generateUuid();
  while (used?.has(id)) id = generateUuid();
  return id;
}
