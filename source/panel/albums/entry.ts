import { startLatticeAlbumWall } from './main.ts';
import { createPluginWallApi } from '../host/pluginApi.ts';

void startLatticeAlbumWall(createPluginWallApi(echo));
