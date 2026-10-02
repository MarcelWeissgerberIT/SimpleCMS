import { customAlphabet } from 'nanoid'

// URL-safe, short, no ambiguous chars. 12 chars ≈ 1e18 combinations.
const alphabet = '0123456789abcdefghijkmnopqrstuvwxyz'
export const newId = customAlphabet(alphabet, 12)
