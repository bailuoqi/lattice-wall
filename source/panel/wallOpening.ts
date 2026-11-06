/** The host shell stays transparent; only this document decides when the wall covers the old page. */
export function createWallOpening(root: HTMLElement) {
  return {
    finish() { delete root.dataset.opening; },
    configure(context: EchoWorkshopUiContext) {
      if (context.desktop) delete root.dataset.opening;
    },
  };
}
