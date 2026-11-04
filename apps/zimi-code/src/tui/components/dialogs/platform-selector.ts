import { OPEN_PLATFORMS } from '@zimi-ai/zimi-code-oauth';

import { ZIMI_CODE_GLOBAL_PLATFORM_VALUE } from '#/utils/region';

import { ChoicePickerComponent, type ChoiceOption } from './choice-picker';

const ZIMI_CODE_MAINLAND_CN_OPTION: ChoiceOption = {
  value: 'zimi-code',
  label: 'Zimi Code (zimi.com/code)',
};
const ZIMI_CODE_GLOBAL_OPTION: ChoiceOption = {
  value: ZIMI_CODE_GLOBAL_PLATFORM_VALUE,
  label: 'Zimi Code (zimi.ai/code)',
};

function platformOptions(): readonly ChoiceOption[] {
  return [
    ZIMI_CODE_MAINLAND_CN_OPTION,
    ZIMI_CODE_GLOBAL_OPTION,
    ...OPEN_PLATFORMS.map((platform) => ({ value: platform.id, label: platform.name })),
  ];
}

export interface PlatformSelectorOptions {
  readonly onSelect: (platformId: string) => void;
  readonly onCancel: () => void;
}

export class PlatformSelectorComponent extends ChoicePickerComponent {
  constructor(opts: PlatformSelectorOptions) {
    super({
      title: 'Select a platform',
      options: [...platformOptions()],
      onSelect: opts.onSelect,
      onCancel: opts.onCancel,
    });
  }
}
