chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (!sender.url.startsWith(chrome.runtime.getURL(""))) {
    sendResponse();
    return;
  }
  if (request && request.type == "testBrowsingTopics") {
    sendResponse({
      browsingTopicsInDocument: !!document.browsingTopics
    });
  }
});
