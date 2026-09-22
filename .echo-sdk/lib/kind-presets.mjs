export const lyricsStylePresets = ['editorial', 'compact', 'cinema', 'cover'];
export const visualizerPresets = ['bars', 'wave', 'radial'];
export const dspPresets = ['flat', 'vocal', 'bass', '8bit'];
export const lyricsPageStyles = [
  'default',
  'editorial',
  'folded',
  'roseVinyl',
  'cinemaStage',
  'kineticPoster',
  'coverStage',
  'cutBoard',
];
export const lyricsBackgroundModes = ['theme', 'cover', 'coverColor'];
export const lyricsSceneBackgrounds = ['theme', 'cover', 'cover-blur', 'cover-color', 'transparent', 'asset'];
export const lyricsSceneSlots = [
  'cover', 'title', 'artist', 'album', 'lyrics', 'current-line', 'previous-line',
  'next-line', 'translation', 'progress', 'seek-bar', 'time-current', 'time-duration',
  'spectrum', 'status', 'track-tech', 'play-toggle', 'previous-track', 'next-track',
  'volume-slider', 'shuffle-toggle', 'repeat-cycle', 'like-toggle',
];
export const visualizerStyles = ['bars', 'wave', 'radial'];
export const eqFrequenciesHz = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630,
  800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000,
  12500, 16000, 20000,
];
export const eqFilterTypes = ['peaking', 'lowShelf', 'highShelf', 'lowPass', 'highPass', 'notch'];

const hexColorPattern = /^#[0-9a-f]{6}$/iu;

const collectSlots = (node, output = []) => {
  if (!node || typeof node !== 'object') return output;
  if (node.type === 'slot' && typeof node.slot === 'string') output.push(node.slot);
  if (Array.isArray(node.children)) {
    for (const child of node.children) collectSlots(child, output);
  }
  return output;
};

const createBands = (gainAt, extras = {}) => eqFrequenciesHz.map((frequencyHz) => ({
  frequencyHz,
  gainDb: gainAt(frequencyHz),
  q: extras.q ?? 1,
  filterType: extras.filterType ?? 'peaking',
  enabled: true,
}));

const vocalGainAt = (hz) => {
  if (hz <= 80) return -1;
  if (hz <= 250) return -2;
  if (hz <= 500) return -1;
  if (hz <= 800) return 0;
  if (hz <= 2500) return 2;
  if (hz <= 5000) return 1.5;
  if (hz <= 10000) return 1;
  return 0.5;
};

const bassGainAt = (hz) => {
  if (hz <= 31.5) return 2;
  if (hz <= 80) return 3;
  if (hz <= 125) return 1.5;
  if (hz <= 250) return -1;
  if (hz <= 400) return -2;
  if (hz <= 1000) return 0;
  return 0.5;
};

const editorialScene = {
  schemaVersion: 1,
  background: 'cover-blur',
  root: {
    id: 'stage',
    type: 'group',
    style: {
      display: 'grid',
      gridTemplateColumns: 'minmax(220px, 0.8fr) minmax(0, 1.2fr)',
      gap: '40px',
      padding: '32px',
      height: '100%',
    },
    responsive: { compact: { gridTemplateColumns: '1fr', padding: '20px' } },
    children: [
      { id: 'cover', type: 'slot', slot: 'cover', style: { width: '100%', aspectRatio: '1 / 1', borderRadius: '28px' } },
      { id: 'lyrics', type: 'slot', slot: 'lyrics', options: { showTranslation: true, wordHighlightEnabled: true } },
    ],
  },
};

const compactScene = {
  schemaVersion: 1,
  background: 'cover-color',
  root: {
    id: 'stage',
    type: 'group',
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      padding: '20px',
      height: '100%',
    },
    children: [
      {
        id: 'meta',
        type: 'group',
        style: { display: 'flex', alignItems: 'center', gap: '12px' },
        children: [
          { id: 'cover', type: 'slot', slot: 'cover', style: { width: '64px', height: '64px', borderRadius: '12px' } },
          {
            id: 'titles',
            type: 'group',
            style: { display: 'flex', flexDirection: 'column', gap: '4px' },
            children: [
              { id: 'title', type: 'slot', slot: 'title', style: { fontWeight: 700 } },
              { id: 'artist', type: 'slot', slot: 'artist', style: { color: '#91a7b8' } },
            ],
          },
        ],
      },
      { id: 'lyrics', type: 'slot', slot: 'lyrics', options: { showTranslation: false, wordHighlightEnabled: true } },
    ],
  },
};

const cinemaScene = {
  schemaVersion: 1,
  background: 'cover-blur',
  hostChrome: { miniPlayer: 'hidden' },
  root: {
    id: 'stage',
    type: 'group',
    style: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-end',
      gap: '20px',
      padding: '48px',
      height: '100%',
    },
    responsive: { compact: { padding: '20px', gap: '12px' } },
    children: [
      { id: 'title', type: 'slot', slot: 'title', style: { fontSize: '32px', fontWeight: 700, color: '#f5fbff' } },
      { id: 'artist', type: 'slot', slot: 'artist', style: { color: '#91a7b8' } },
      {
        id: 'lyrics',
        type: 'slot',
        slot: 'lyrics',
        options: { showTranslation: true, wordHighlightEnabled: true },
        style: { minHeight: '180px' },
      },
      {
        id: 'transport',
        type: 'group',
        style: { display: 'flex', alignItems: 'center', gap: '16px' },
        children: [
          { id: 'prev', type: 'slot', slot: 'previous-track' },
          { id: 'play', type: 'slot', slot: 'play-toggle' },
          { id: 'next', type: 'slot', slot: 'next-track' },
          { id: 'shuffle', type: 'slot', slot: 'shuffle-toggle' },
          { id: 'repeat', type: 'slot', slot: 'repeat-cycle' },
          { id: 'like', type: 'slot', slot: 'like-toggle' },
          { id: 'progress', type: 'slot', slot: 'progress', style: { flexGrow: 1 } },
        ],
      },
    ],
  },
};

const coverScene = {
  schemaVersion: 1,
  background: 'cover',
  root: {
    id: 'stage',
    type: 'group',
    style: {
      display: 'grid',
      gridTemplateColumns: 'minmax(280px, 1fr) minmax(0, 1fr)',
      alignItems: 'center',
      gap: '48px',
      padding: '40px',
      height: '100%',
    },
    responsive: { compact: { gridTemplateColumns: '1fr', padding: '20px', gap: '20px' } },
    children: [
      { id: 'cover', type: 'slot', slot: 'cover', style: { width: '100%', aspectRatio: '1 / 1', borderRadius: '36px' } },
      {
        id: 'copy',
        type: 'group',
        style: { display: 'flex', flexDirection: 'column', gap: '16px' },
        children: [
          { id: 'title', type: 'slot', slot: 'title', style: { fontSize: '28px', fontWeight: 700 } },
          { id: 'artist', type: 'slot', slot: 'artist' },
          { id: 'lyrics', type: 'slot', slot: 'lyrics', options: { showTranslation: true, wordHighlightEnabled: true } },
        ],
      },
    ],
  },
};

export const createLyricsStyleEntry = (preset, id, title) => {
  if (preset === 'compact') {
    return {
      type: 'echo-workshop-lyrics-style',
      schemaVersion: 1,
      id,
      title,
      description: 'A compact folded lyrics scene with metadata in one row.',
      settings: {
        lyricsPageStyle: 'folded',
        lyricsWordHighlightEnabled: true,
        lyricsMusicReactiveVisualsEnabled: false,
        lyricsFontSizePx: 28,
      },
      scene: compactScene,
    };
  }
  if (preset === 'cinema') {
    return {
      type: 'echo-workshop-lyrics-style',
      schemaVersion: 1,
      id,
      title,
      description: 'A cinema-stage lyrics scene that owns transport because the host mini player is hidden.',
      settings: {
        lyricsPageStyle: 'cinemaStage',
        lyricsWordHighlightEnabled: true,
        lyricsMusicReactiveVisualsEnabled: true,
        lyricsFontSizePx: 48,
        lyricsBackgroundMode: 'cover',
      },
      scene: cinemaScene,
    };
  }
  if (preset === 'cover') {
    return {
      type: 'echo-workshop-lyrics-style',
      schemaVersion: 1,
      id,
      title,
      description: 'A cover-stage lyrics scene with a large album art column.',
      settings: {
        lyricsPageStyle: 'coverStage',
        lyricsWordHighlightEnabled: true,
        lyricsMusicReactiveVisualsEnabled: true,
        lyricsFontSizePx: 36,
      },
      scene: coverScene,
    };
  }
  return {
    type: 'echo-workshop-lyrics-style',
    schemaVersion: 1,
    id,
    title,
    description: 'A responsive declarative lyrics scene.',
    settings: {
      lyricsPageStyle: 'editorial',
      lyricsWordHighlightEnabled: true,
      lyricsMusicReactiveVisualsEnabled: true,
      lyricsFontSizePx: 42,
    },
    scene: editorialScene,
  };
};

export const createVisualizerEntry = (preset, id, title) => {
  if (preset === 'wave') {
    return {
      type: 'echo-workshop-visualizer-preset',
      schemaVersion: 1,
      id,
      title,
      description: 'A smooth waveform visualizer with a warm harbor palette.',
      style: 'wave',
      palette: ['#8cdbff', '#f0b35b'],
      barCount: 64,
      smoothing: 0.82,
      sensitivity: 1.1,
      decay: 0.28,
      mirror: false,
    };
  }
  if (preset === 'radial') {
    return {
      type: 'echo-workshop-visualizer-preset',
      schemaVersion: 1,
      id,
      title,
      description: 'A radial spectrum with a three-stop dusk palette.',
      style: 'radial',
      palette: ['#66ccff', '#c48bff', '#f0b35b'],
      barCount: 72,
      smoothing: 0.7,
      sensitivity: 1.35,
      decay: 0.36,
      mirror: false,
    };
  }
  return {
    type: 'echo-workshop-visualizer-preset',
    schemaVersion: 1,
    id,
    title,
    description: 'A mirrored high-resolution spectrum preset.',
    style: 'bars',
    palette: ['#66ccff', '#99ffcc'],
    barCount: 48,
    smoothing: 0.75,
    sensitivity: 1.2,
    decay: 0.4,
    mirror: true,
  };
};

export const createDspEntry = (preset, id, title) => {
  if (preset === '8bit') {
    return {
      type: 'echo-workshop-dsp-preset',
      schemaVersion: 1,
      id,
      title,
      description: 'An unmistakable console-style chiptune preset with pulse, triangle-bass and noise-drum layers executed by Audio Core.',
      preampDb: -6,
      bands: createBands(() => 0),
      audioEffect: {
        type: 'chiptune',
        bitDepth: 8,
        sampleRateHz: 8000,
        mix: 1,
        outputGainDb: -5,
        pulseMix: 0.82,
        triangleMix: 0.5,
        noiseMix: 0.22,
        drive: 3.2,
      },
    };
  }
  if (preset === 'vocal') {
    return {
      type: 'echo-workshop-dsp-preset',
      schemaVersion: 1,
      id,
      title,
      description: 'A conservative vocal-forward 31-band EQ starting point.',
      preampDb: -4,
      bands: createBands(vocalGainAt),
    };
  }
  if (preset === 'bass') {
    return {
      type: 'echo-workshop-dsp-preset',
      schemaVersion: 1,
      id,
      title,
      description: 'A conservative low-end 31-band EQ starting point with extra preamp headroom.',
      preampDb: -5,
      bands: createBands(bassGainAt),
    };
  }
  return {
    type: 'echo-workshop-dsp-preset',
    schemaVersion: 1,
    id,
    title,
    description: 'A conservative 31-band EQ starting point.',
    preampDb: -6,
    bands: createBands(() => 0),
  };
};

export const inferLyricsPreset = (entry) => {
  const style = entry?.settings?.lyricsPageStyle;
  if (style === 'cinemaStage') return 'cinema';
  if (style === 'coverStage') return 'cover';
  if (style === 'folded') return 'compact';
  return 'editorial';
};

export const inferVisualizerPreset = (entry) => (
  visualizerStyles.includes(entry?.style) ? entry.style : 'bars'
);

export const inferDspPreset = (entry) => {
  if (entry?.audioEffect?.type === 'bitcrusher' || entry?.audioEffect?.type === 'chiptune') return '8bit';
  const bands = Array.isArray(entry?.bands) ? entry.bands : [];
  const low = bands.find((band) => band.frequencyHz === 80)?.gainDb ?? 0;
  const mid = bands.find((band) => band.frequencyHz === 2000)?.gainDb ?? 0;
  if (low >= 2) return 'bass';
  if (mid >= 1.5) return 'vocal';
  return 'flat';
};

export const describeLyricsCustomization = (entry) => ({
  preset: inferLyricsPreset(entry),
  pageStyle: entry?.settings?.lyricsPageStyle ?? null,
  background: entry?.scene?.background ?? null,
  slots: collectSlots(entry?.scene?.root),
  hidesMiniPlayer: entry?.scene?.hostChrome?.miniPlayer === 'hidden',
});

export const describeVisualizerCustomization = (entry) => ({
  preset: inferVisualizerPreset(entry),
  style: entry?.style ?? null,
  palette: Array.isArray(entry?.palette) ? entry.palette : [],
  barCount: entry?.barCount ?? null,
  mirror: entry?.mirror ?? null,
});

export const describeDspCustomization = (entry) => ({
  preset: inferDspPreset(entry),
  preampDb: entry?.preampDb ?? null,
  bandCount: Array.isArray(entry?.bands) ? entry.bands.length : 0,
});

export const collectLyricsSceneSlots = collectSlots;

export const isHexColor = (value) => hexColorPattern.test(String(value ?? ''));
