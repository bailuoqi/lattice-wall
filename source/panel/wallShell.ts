export const wallShell = (label: string, locateLabel: string): string => `
<main class="lattice" id="lattice">
  <div class="field" id="field" tabindex="0" role="application" aria-label="${label}">
    <div class="world" id="world"></div>
    <div class="field__vignette" aria-hidden="true"></div>
  </div>
  <button class="locate" id="locate" type="button" data-visible="false" aria-label="${locateLabel}" title="${locateLabel}">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="6.5"></circle>
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"></circle>
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"></path>
    </svg>
  </button>
  <section class="state" id="state" role="status" aria-live="polite" hidden></section>
</main>`;
