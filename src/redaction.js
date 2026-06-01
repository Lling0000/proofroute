export function redactSupportText(value) {
  return redactSupportSecrets(String(value ?? '')
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

export function redactSupportDocument(value) {
  return redactSupportSecrets(String(value ?? '')
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .trim());
}

export function redactSupportValue(value) {
  if (typeof value === 'string') return redactSupportText(value);
  if (Array.isArray(value)) return value.map((item) => redactSupportValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactSupportValue(item)]));
  }
  return value;
}

function redactSupportSecrets(value) {
  return String(value)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^@\s/?#]+)@/gi, '$1<redacted>@')
    .replace(/([?&][^=\s&]*(?:token|secret|password|key|auth)[^=\s&]*=)[^&\s]+/gi, '$1<redacted>')
    .replace(/\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY|AUTH)[A-Z0-9_]*=(["']?)[^\s"'&]+/gi, '<redacted-secret>')
    .replace(/\b(?:_?authToken|authorization|password|secret|token|api[_-]?key)=([^\s&]+)/gi, '<redacted-secret>')
    .replace(/\b(Authorization:\s*Bearer\s+)[^\s]+/gi, '$1<redacted>')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1<redacted>')
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, 'sk-<redacted>')
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g, 'gh-<redacted>')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, 'github_pat_<redacted>')
    .replace(/\/Users\/[^/\s]+(?:\/[^\s`'"]*)?/g, '<local-path>')
    .replace(/\/home\/[^/\s]+(?:\/[^\s`'"]*)?/g, '<local-path>')
    .replace(/[A-Z]:\\Users\\[^\\\s]+(?:\\[^\s`'"]*)?/g, '<local-path>');
}
