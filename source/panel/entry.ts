import { startLatticeLibraryWall } from './main.ts';
import { createPluginWallApi } from './host/pluginApi.ts';

void startLatticeLibraryWall(createPluginWallApi(echo));
