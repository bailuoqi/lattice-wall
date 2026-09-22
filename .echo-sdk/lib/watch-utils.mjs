const normalizeFilename = (filename) => String(filename ?? '').split('\\').join('/');

export const isGeneratedWorkshopChange = (filename) => {
  const normalized = normalizeFilename(filename).toLowerCase();
  return normalized === 'echo.workshop.json' || normalized.endsWith('/echo.workshop.json');
};

export const createDebouncedRunner = ({ delayMs = 120, run, onError }) => {
  let timer = null;
  let running = false;
  let pending = false;
  let latestChange = null;

  const execute = async () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    do {
      pending = false;
      const changedFile = latestChange;
      try {
        await run(changedFile);
      } catch (error) {
        if (onError) onError(error, changedFile);
      }
    } while (pending);
    running = false;
  };

  return {
    schedule(filename) {
      latestChange = normalizeFilename(filename) || '(unknown file)';
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void execute();
      }, delayMs);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
};
