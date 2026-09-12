import { normalizeEmail } from './http';
export function isAnalysisExempt(email: string, allowlist = ''): boolean {
  const owner=normalizeEmail(email);
  return owner!==null && allowlist.split(',').some(entry=>normalizeEmail(entry)===owner);
}
