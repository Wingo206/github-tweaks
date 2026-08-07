const DEFAULT_PORT = 17373;

const portInput = document.getElementById('port');
const computedInput = document.getElementById('computed');
const pickButton = document.getElementById('pick');
const healthButton = document.getElementById('health');
const statusEl = document.getElementById('status');

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

async function loadSettings() {
  const stored = await chrome.storage.local.get({
    port: DEFAULT_PORT,
    includeComputed: false,
  });
  portInput.value = String(stored.port);
  computedInput.checked = Boolean(stored.includeComputed);
}

async function saveSettings() {
  const port = Number(portInput.value) || DEFAULT_PORT;
  await chrome.storage.local.set({
    port,
    includeComputed: computedInput.checked,
  });
  return port;
}

pickButton.addEventListener('click', async () => {
  try {
    const port = await saveSettings();
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) {
      setStatus('No active tab.', 'err');
      return;
    }
    if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
      setStatus('Cannot pick on chrome:// pages. Open a normal page.', 'err');
      return;
    }

    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['content.css'],
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });
    await chrome.tabs.sendMessage(tab.id, {
      type: 'ght-dom-dump-start',
      port,
      includeComputed: computedInput.checked,
    });
    setStatus('Picking on the active tab…', 'ok');
    window.close();
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : String(error),
      'err',
    );
  }
});

healthButton.addEventListener('click', async () => {
  try {
    const port = await saveSettings();
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const data = await response.json();
    if (!response.ok || !data.ok) {
      setStatus(`Receiver not healthy on :${port}`, 'err');
      return;
    }
    setStatus(`OK — dumps at\n${data.dumpsDir}`, 'ok');
  } catch (error) {
    setStatus(
      `Cannot reach receiver. Start it with:\npnpm dump-receiver\n(${
        error instanceof Error ? error.message : String(error)
      })`,
      'err',
    );
  }
});

loadSettings();
