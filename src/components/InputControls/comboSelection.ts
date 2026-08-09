import type { OnChangeValue } from 'react-select';
import type { ComboSelectOption } from './ModelComboOption';

const NULL_OPTION_VALUE = '__null__';

function decodeOption(option: ComboSelectOption): unknown {
  return option.value === NULL_OPTION_VALUE
    ? null
    : option.rawValue ?? option.value;
}

export function comboSelectionToValue(
  selection: OnChangeValue<ComboSelectOption, boolean>,
  multiSelect: boolean,
): unknown {
  if (multiSelect) {
    if (!Array.isArray(selection)) return [];
    return selection.map(decodeOption);
  }
  const option = Array.isArray(selection) ? selection[0] : selection;
  if (!option) return undefined;
  return decodeOption(option);
}
