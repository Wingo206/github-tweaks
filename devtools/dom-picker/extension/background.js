const DEFAULT_PORT = 17373;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'ght-dom-dump-submit') {
    submitDump(message.payload)
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }
  return false;
});

async function submitDump(payload) {
  const { port = DEFAULT_PORT } = await chrome.storage.local.get({
    port: DEFAULT_PORT,
  });
  const endpoint = `http://127.0.0.1:${port}/dump`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { ok: false, error: text || `HTTP ${response.status}` };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: data.error || `HTTP ${response.status}`,
      data,
    };
  }
  return data;
}
