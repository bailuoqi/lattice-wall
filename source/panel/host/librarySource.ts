/** Supported by the ECHO 26.10.4 panel bridge; absent from the vendored SDK types. */
export type LibrarySource = 'local' | 'remote';

export type LibraryPageQuery = EchoWorkshopPageQuery & { sourceProvider?: LibrarySource };
