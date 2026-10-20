/** Product identity is configurable: set VITE_PRODUCT_NAME at build time (and productName in tauri.conf.json). */
export const PRODUCT_NAME: string = import.meta.env.VITE_PRODUCT_NAME ?? "FlowForge";
export const FILE_EXTENSION = "flowforge.json";
