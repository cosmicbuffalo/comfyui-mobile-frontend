import { create } from 'zustand';

interface NoWorkflowImageModalState {
  open: boolean;
  filename: string | null;
  // Surface the "this image has no embedded workflow" dialog. Shared by the
  // device picker and the workflow-panel drag-and-drop so they show one dialog.
  show: (filename?: string | null) => void;
  dismiss: () => void;
}

export const useNoWorkflowImageModal = create<NoWorkflowImageModalState>((set) => ({
  open: false,
  filename: null,
  show: (filename = null) => set({ open: true, filename }),
  dismiss: () => set({ open: false, filename: null }),
}));
