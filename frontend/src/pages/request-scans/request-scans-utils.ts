export function sanitizeClinicalDocumentExportError(value: unknown): string | null {
  const text = String(value ?? "")
    .replace(/(https?:\/\/)([^\s/@]+)@/gi, "$1[redacted]@")
    .replace(/([?&](?:token|access_token|api[_-]?key|apikey|password)\s*=)[^&#\s]*/gi, "$1[redacted]")
    .replace(/\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|apikey)\s*[:=]\s*[^\r\n]*/gi, "$1: [redacted]")
    .replace(/\b(?:basic|bearer|token|apikey|api[- ]?key)\s+[A-Za-z0-9._~+/-]+=*/gi, "authentication [redacted]")
    .replace(/(["'])(?:[A-Za-z]:\\|\\\\|\/)[^"'\r\n]+\1/g, "local path")
    .replace(/(?:[A-Za-z]:\\|\\\\)[^\r\n"'<>|?*]*?\.[A-Za-z0-9]{1,16}(?=\s|[),;:!?]|$)/g, "local path")
    .replace(/(?<![:/])\/(?:[^/\r\n"'<>|?*]+\/)+[^\r\n"'<>|?*]*?\.[A-Za-z0-9]{1,16}(?=\s|[),;:!?]|$)/g, "local path")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 300) : null;
}
