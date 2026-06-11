export const appChromeIconButtonClassName =
  'bg-slate-900/95 border border-white/10 text-slate-200 hover:bg-slate-800/95 hover:text-slate-100';

// Shared base for the square 48px bottom-bar chrome buttons. State-dependent
// color/active classes are appended per button.
export const chromeBarButtonClassName =
  'relative w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-colors';

// Bare icon-only variant: no background or outline, just the icon. Used by the
// main menu button and the per-panel context menu buttons in the top bar.
export const appChromeIconButtonBareClassName =
  'text-slate-200 hover:text-slate-100';

export const appChromeIconButtonActiveClassName =
  'bg-cyan-500 border border-cyan-500 text-slate-950 shadow-sm';

export const appChromePrimaryButtonClassName =
  'bg-cyan-500 text-slate-950 active:bg-cyan-400';

export const appChromePrimaryButtonDisabledClassName =
  'bg-slate-800 text-slate-500 cursor-not-allowed';
