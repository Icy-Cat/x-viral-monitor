// Open side panel on extension icon click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Relay messages between sidePanel and content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === 'sidepanel') {
    // From content/bridge → sidePanel
    chrome.runtime.sendMessage(msg);
  } else if (msg.target === 'content') {
    // From sidePanel → content script on active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, msg);
    });
  }
});
