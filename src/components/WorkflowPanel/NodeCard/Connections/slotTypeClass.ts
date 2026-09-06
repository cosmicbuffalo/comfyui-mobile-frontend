/**
 * CSS class carrying a slot's type colour, shared by every connection button so
 * the palette cannot drift between the node cards and the subgraph boundary
 * section. The classes themselves live in index.css (`.type-IMAGE`, …).
 */
export function getTypeClass(type: string): string {
  const normalizedType = String(type).split(',')[0].trim(); // Handle multi-types like "FLOAT,INT"
  const knownTypes = ['IMAGE', 'LATENT', 'MODEL', 'CLIP', 'VAE', 'CONDITIONING', 'INT', 'FLOAT', 'STRING', 'BOOLEAN', 'MASK'];

  if (knownTypes.includes(normalizedType)) {
    return `type-${normalizedType}`;
  }
  return 'type-default';
}
