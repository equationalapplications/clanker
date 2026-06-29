document.getElementById('open')!.addEventListener('click', () => {
  void chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT })
})
chrome.storage.local.get(['paused']).then(({ paused }) => {
  document.getElementById('badge')!.textContent = paused ? 'Clanker Bridge — Paused' : 'Clanker Bridge — Active'
})
