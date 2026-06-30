export type LogEntry = { ts: number; action: string; status: string }

export function renderLogEntries(
  logEl: HTMLElement,
  entries: LogEntry[],
  doc: Document = document,
): void {
  logEl.textContent = ''
  for (const entry of entries) {
    const li = doc.createElement('li')
    li.textContent = `${new Date(entry.ts).toLocaleTimeString()} ${entry.action} ${entry.status === 'complete' ? '✓' : '✕'}`
    logEl.appendChild(li)
  }
}
