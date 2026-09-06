import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { WidgetVariationsModal } from '@/components/modals/WidgetVariationsModal';

const SAMPLERS = ['euler', 'dpmpp_2m', 'ddim', 'uni_pc'];

const options = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('.widget-variations-option'));
const checkedLabels = () =>
  options()
    .filter((option) => option.getAttribute('aria-checked') === 'true')
    .map((option) => option.textContent?.replace(/current$/, '') ?? '');
const button = (selector: string) =>
  document.querySelector<HTMLButtonElement>(selector) as HTMLButtonElement;

describe('WidgetVariationsModal', () => {
  let container: HTMLDivElement;
  let root: Root;
  let queueWorkflow: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queueWorkflow = vi.fn(async () => true);
    useWorkflowStore.setState({ queueWorkflow } as never);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = '';
  });

  const render = async (currentValue: unknown = 'euler', onClose = vi.fn()) => {
    await act(async () => {
      root.render(
        <WidgetVariationsModal
          target={{ nodeId: 3, subgraphId: null, widgetIndex: 4 }}
          widgetName="sampler_name"
          nodeName="KSampler"
          options={SAMPLERS}
          currentValue={currentValue}
          onClose={onClose}
        />,
      );
    });
    return onClose;
  };

  it('lists every option and names what is being varied', async () => {
    await render();
    expect(options().map((option) => option.textContent)).toHaveLength(4);
    expect(document.querySelector('.widget-variations-subject')?.textContent)
      .toBe('KSampler · sampler_name');
  });

  it('preselects the value the widget already holds', async () => {
    await render('dpmpp_2m');
    expect(checkedLabels()).toEqual(['dpmpp_2m']);
    expect(document.querySelector('.widget-variations-current')?.textContent).toBe('current');
  });

  it('toggles an option from anywhere on the row', async () => {
    await render('euler');
    await act(async () => options()[2].click());
    expect(checkedLabels()).toEqual(['euler', 'ddim']);
    await act(async () => options()[2].click());
    expect(checkedLabels()).toEqual(['euler']);
  });

  it('selects and clears the whole list from the toolbar', async () => {
    await render('euler');
    await act(async () => button('.widget-variations-select-all').click());
    expect(checkedLabels()).toHaveLength(4);
    expect(document.querySelector('.widget-variations-count')?.textContent).toBe('4 of 4');

    await act(async () => button('.widget-variations-deselect-all').click());
    expect(checkedLabels()).toEqual([]);
    expect(document.querySelector('.widget-variations-count')?.textContent).toBe('0 of 4');
  });

  it('cannot be submitted with nothing selected', async () => {
    await render('euler');
    await act(async () => button('.widget-variations-deselect-all').click());
    expect(button('.widget-variations-run').disabled).toBe(true);
    await act(async () => button('.widget-variations-run').click());
    expect(queueWorkflow).not.toHaveBeenCalled();
  });

  it('queues one run per checked option, in list order', async () => {
    // Click order is deliberately reversed: the queue should still read the way
    // the list did, so the outputs come back in a comparable order.
    const onClose = await render('euler');
    await act(async () => button('.widget-variations-deselect-all').click());
    await act(async () => options()[3].click());
    await act(async () => options()[1].click());
    await act(async () => button('.widget-variations-run').click());

    expect(queueWorkflow).toHaveBeenCalledWith(2, undefined, false, false, {
      nodeId: 3,
      subgraphId: null,
      widgetIndex: 4,
      widgetName: 'sampler_name',
      values: ['dpmpp_2m', 'uni_pc'],
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('stays open when the queue rejects the batch, so the selection is not lost', async () => {
    queueWorkflow.mockResolvedValueOnce(false);
    const onClose = await render('euler');
    await act(async () => button('.widget-variations-run').click());
    expect(onClose).not.toHaveBeenCalled();
    expect(checkedLabels()).toEqual(['euler']);
  });

  it('tells the user that everything else is held fixed', async () => {
    // The seed carve-out is the non-obvious part of the feature and it is
    // invisible in the output, so it has to be stated where the run is started.
    await render();
    expect(document.querySelector('.widget-variations-note')?.textContent)
      .toContain('seeds set to randomize');
  });
});
