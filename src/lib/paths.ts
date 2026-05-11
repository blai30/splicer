/**
 * Construct a safe asset path with BASE_URL.
 * Handles edge cases: relative/absolute paths, trailing slashes.
 *
 * Works with any BASE_URL format (with or without trailing slash),
 * and any relative path format (with or without leading slash).
 *
 * @param relativePath Path relative to base (e.g., 'brand/logo.svg' or '/brand/logo.svg')
 * @returns Full asset path (e.g., '/splicer/brand/logo.svg')
 */
export function assetPath(relativePath: string): string {
  const baseUrl = import.meta.env.BASE_URL

  // Ensure baseUrl ends with /
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`

  // Remove leading / from relative path if present
  const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath

  return `${normalizedBase}${cleanPath}`
}
