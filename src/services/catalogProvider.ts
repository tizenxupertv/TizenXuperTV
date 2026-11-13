export interface CatalogHome {
  root: string;
  pageNum: number;
  items: unknown[];
}

export interface CatalogPage {
  items: any[];
  total: number;
}

export interface CatalogColumn {
  id: number;
  code: string;
  name: string;
  free: boolean;
  sequence: number;
}

interface LegacyCatalogClient {
  rootIds?: Record<string, number>;
  home?: (root: string, pageNum: number, callback: (error: unknown, value?: CatalogHome) => void, options?: { low?: boolean }) => void;
  getHome?: (callback: (error: unknown, value?: unknown) => void) => void;
  columns?: (columnId: number, callback: (error: unknown, value?: CatalogColumn[]) => void, options?: { special?: boolean }) => void;
  columnPage?: (columnId: number, pageNum: number, pageSize: number, callback: (error: unknown, value?: CatalogPage) => void, options?: { restricted?: boolean }) => void;
}

/**
 * Boundary between the UI/catalog services and a concrete catalog implementation.
 *
 * The installed client and the local development mock expose the same callback API;
 * this adapter turns that API into promises so a future authorized provider can be
 * added without changing screens or catalog normalization.
 */
export interface CatalogProvider {
  rootId(root: string): number | undefined;
  home(root: string, pageNum: number, options?: { low?: boolean }): Promise<CatalogHome>;
  compositeHome(): Promise<unknown>;
  columns(columnId: number, options?: { special?: boolean }): Promise<CatalogColumn[]>;
  columnPage(columnId: number, pageNum: number, pageSize: number, options?: { restricted?: boolean }): Promise<CatalogPage>;
}

function legacyClient(): LegacyCatalogClient | null {
  if (typeof window === 'undefined') return null;
  return (window as any).MagisClient || null;
}

function unavailable(): Error {
  return new Error('catalog provider unavailable');
}

export const catalogProvider: CatalogProvider = {
  rootId(root) {
    return legacyClient()?.rootIds?.[root];
  },

  home(root, pageNum, options) {
    return new Promise((resolve, reject) => {
      const client = legacyClient();
      if (!client?.home) return reject(unavailable());
      client.home(root, pageNum, (error, value) => error ? reject(error) : resolve(value || { root, pageNum, items: [] }), options);
    });
  },

  compositeHome() {
    return new Promise((resolve, reject) => {
      const client = legacyClient();
      if (!client?.getHome) return reject(unavailable());
      client.getHome((error, value) => error ? reject(error) : resolve(value || {}));
    });
  },

  columns(columnId, options) {
    return new Promise((resolve, reject) => {
      const client = legacyClient();
      if (!client?.columns) return reject(unavailable());
      client.columns(columnId, (error, value) => error ? reject(error) : resolve(value || []), options);
    });
  },

  columnPage(columnId, pageNum, pageSize, options) {
    return new Promise((resolve, reject) => {
      const client = legacyClient();
      if (!client?.columnPage) return reject(unavailable());
      client.columnPage(columnId, pageNum, pageSize, (error, value) => error ? reject(error) : resolve(value || { items: [], total: 0 }), options);
    });
  }
};
