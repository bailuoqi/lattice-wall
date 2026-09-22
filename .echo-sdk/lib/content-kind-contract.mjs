import { readFileSync } from 'node:fs';

// Single source of truth shared with the production authoring service
// (src/shared/workshop/workshopContentKindContract.ts consumes the same JSON).
const contract = JSON.parse(
  readFileSync(new URL('../contracts/content-kinds.json', import.meta.url), 'utf8'),
);

export const contentKindContractVersion = contract.version;
export const steamworksConfiguredTags = Object.freeze([...contract.steamworksTags]);
export const contentKinds = Object.freeze(Object.keys(contract.kinds));
export const entryFileForKind = (kind) => contract.kinds[kind]?.entry;
export const steamTagForKind = (kind) => contract.kinds[kind]?.tag;
export const isSteamworksConfiguredTag = (tag) => contract.steamworksTags.includes(tag);
