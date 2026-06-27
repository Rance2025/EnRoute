export type MapStylePreference = 'primary' | 'alternate'

export type MapStyleOption = {
  value: MapStylePreference
  label: string
  url: string
}

export const MAP_STYLE_OPTIONS: MapStyleOption[] = [
  {
    value: 'primary',
    label: '水',
    url: 'mapbox://styles/oies0/cmqw4e7m7001101qo7kmvdwry/draft',
  },
  {
    value: 'alternate',
    label: '墨',
    url: 'mapbox://styles/oies0/cmqvb5b20001e01s72ia82lz5',
  },
]

export const DEFAULT_MAP_STYLE = MAP_STYLE_OPTIONS[0]
export const DEFAULT_MAPBOX_STYLE_URL = DEFAULT_MAP_STYLE.url

export function resolveMapStyleOption(style: MapStylePreference) {
  return MAP_STYLE_OPTIONS.find((option) => option.value === style) ?? DEFAULT_MAP_STYLE
}
