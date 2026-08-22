import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// minimal-2023 preset, with the maskable icon padded over the brand colour
// instead of the default white — otherwise Android's adaptive icon shows a
// white border around the mark.
export default defineConfig({
  headLinkOptions: {
    preset: '2023'
  },
  preset: {
    ...minimal2023Preset,
    maskable: {
      ...minimal2023Preset.maskable,
      resizeOptions: {
        ...minimal2023Preset.maskable.resizeOptions,
        background: '#dc2626'
      }
    }
  },
  images: ['public/logo.svg']
});
