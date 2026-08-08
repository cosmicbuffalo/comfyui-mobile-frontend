import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LoraManagerModel } from '@/api/loraManagerClient';
import { ModelRowContent } from '@/components/InputControls/ModelComboOption';

function modelWithPreview(previewUrl: string): LoraManagerModel {
  return {
    model_name: 'Demo',
    file_name: 'demo',
    preview_url: previewUrl,
    base_model: 'SDXL 1.0',
    folder: '',
    sha256: '',
    file_path: '/models/loras/demo.safetensors',
    file_size: 1,
    sub_type: 'lora',
  };
}

describe('ModelRowContent previews', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('uses a cached still thumbnail for standalone video previews', async () => {
    await act(async () => {
      root.render(
        <ModelRowContent
          option={{
            value: 'demo.safetensors',
            label: 'Demo',
            model: modelWithPreview('/mobile/api/models/previews?path=%2Fmodels%2Fdemo.mp4'),
          }}
        />,
      );
    });

    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/mobile/api/models/previews?path=%2Fmodels%2Fdemo.mp4&w=88',
    );
  });

  it('routes Lora Manager video previews through the still-thumbnail endpoint', async () => {
    await act(async () => {
      root.render(
        <ModelRowContent
          option={{
            value: 'demo.safetensors',
            label: 'Demo',
            model: modelWithPreview('/api/lm/previews?path=%2Fmodels%2Fdemo.mp4'),
          }}
        />,
      );
    });

    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/mobile/api/models/previews?path=%2Fmodels%2Fdemo.mp4&w=88',
    );
  });
});
