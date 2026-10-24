/** "Name <a@b.c>" or "a@b.c" -> "a@b.c", lowercased. */
export function bareAddress(input: string | null | undefined): string {
  if (!input) return "";
  const match = input.match(/<([^<>]+)>/);
  return (match?.[1] ?? input).trim().toLowerCase();
}

export function splitAddress(input: string): { local: string; domain: string } | null {
  const bare = bareAddress(input);
  const at = bare.lastIndexOf("@");
  if (at <= 0 || at === bare.length - 1) return null;
  return { local: bare.slice(0, at), domain: bare.slice(at + 1) };
}

export function isAddress(input: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(bareAddress(input));
}

export function uniqueAddresses(list: Array<string | null | undefined>): string[] {
  return [...new Set(list.map(bareAddress).filter(Boolean))];
}

/** Subject with any run of leading Re:/Fwd: (and localised AW:/SV:) removed. */
export function baseSubject(subject: string): string {
  return subject
    .replace(/^(\s*(re|fwd?|aw|sv|antw)\s*(\[\d+\])?\s*:\s*)+/i, "")
    .trim()
    .toLowerCase();
}

export function isReplySubject(subject: string): boolean {
  return /^\s*(re|fwd?|aw|sv|antw)\s*(\[\d+\])?\s*:/i.test(subject);
}
