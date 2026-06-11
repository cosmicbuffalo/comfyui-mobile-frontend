import type { PanelMode } from '@/hooks/useNavigation';

export interface TopBarPanelNavigationItem {
  panel: PanelMode;
  label: string;
  direction: 'left' | 'right';
  jumps: 1 | 2;
}

export interface TopBarPanelNavigationConfig {
  left: TopBarPanelNavigationItem[];
  right: TopBarPanelNavigationItem[];
}

const panelLabels: Record<PanelMode, string> = {
  outputs: 'Outputs',
  workflow: 'Workflow',
  queue: 'Queue',
};

const panelOrder: PanelMode[] = ['outputs', 'workflow', 'queue'];

export function getTopBarPanelNavigation(mode: PanelMode): TopBarPanelNavigationConfig {
  const currentIndex = panelOrder.indexOf(mode);
  const itemFor = (panel: PanelMode): TopBarPanelNavigationItem => {
    const targetIndex = panelOrder.indexOf(panel);
    return {
      panel,
      label: panelLabels[panel],
      direction: targetIndex < currentIndex ? 'left' : 'right',
      jumps: Math.abs(targetIndex - currentIndex) as 1 | 2,
    };
  };

  return {
    left: panelOrder.slice(0, currentIndex).map(itemFor),
    right: panelOrder.slice(currentIndex + 1).map(itemFor),
  };
}
