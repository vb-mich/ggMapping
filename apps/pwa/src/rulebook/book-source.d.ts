// The @book alias resolves in vite.config.ts to the handbook markdown in
// /docs; ?raw imports it as a string at build time.
declare module "@book?raw" {
  const source: string;
  export default source;
}
