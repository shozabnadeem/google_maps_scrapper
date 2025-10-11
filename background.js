// Background script for the Google Maps Scraper extension
console.log('Google Maps Scraper background script loaded');

class BackgroundScript {
  constructor() {
    this.init();
  }

  init() {
    this.setupContextMenu();
    this.setupMessageListener();
    this.setupTabListener();
  }

  setupContextMenu() {
    // Check if contextMenus API is available
    if (chrome.contextMenus) {
      chrome.runtime.onInstalled.addListener(() => {
        try {
          chrome.contextMenus.create({
            id: 'scrapeMaps',
            title: 'Scrape Google Maps Results',
            contexts: ['page'],
            documentUrlPatterns: [
              'https://www.google.com/maps/*',
              'https://maps.google.com/*'
            ]
          });
        } catch (error) {
          console.log('Context menu creation failed:', error);
        }
      });

      chrome.contextMenus.onClicked.addListener((info, tab) => {
        if (info.menuItemId === 'scrapeMaps') {
          this.openPopup(tab);
        }
      });
    } else {
      console.log('Context menus not available');
    }
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      try {
        console.log('Background received message:', message);
        
        switch (message.action) {
          case 'scrapingUpdate':
          case 'scrapingComplete':
          case 'scrapingStopped':
          case 'scrapingError':
            // Forward messages to popup if it's open
            this.forwardToPopup(message);
            break;
          case 'getTabInfo':
            this.getTabInfo(sendResponse);
            return true; // Keep message channel open
          default:
            console.log('Unknown message action:', message.action);
        }
      } catch (error) {
        console.error('Error in message listener:', error);
      }
    });
  }

  setupTabListener() {
    // Listen for tab updates to check if user navigates to Google Maps
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && this.isGoogleMapsTab(tab)) {
        // Inject content script if needed
        this.ensureContentScriptInjected(tabId);
      }
    });
  }

  isGoogleMapsTab(tab) {
    return tab.url && (
      tab.url.includes('maps.google.com') || 
      tab.url.includes('google.com/maps')
    );
  }

  async ensureContentScriptInjected(tabId) {
    try {
      // Check if content script is already injected
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          return window.mapsScraperInjected === true;
        }
      });

      if (!result[0]?.result) {
        // Inject content script
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js']
        });
        
        // Mark as injected
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            window.mapsScraperInjected = true;
          }
        });
      }
    } catch (error) {
      console.error('Error injecting content script:', error);
    }
  }

  async openPopup(tab) {
    try {
      // Open the extension popup programmatically
      chrome.action.openPopup();
    } catch (error) {
      console.error('Error opening popup:', error);
    }
  }

  forwardToPopup(message) {
    // Try to send message to popup
    chrome.runtime.sendMessage(message).catch(() => {
      // Popup might not be open, that's okay
      console.log('Could not forward message to popup (popup might be closed)');
    });
  }

  getTabInfo(sendResponse) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        sendResponse({
          url: tabs[0].url,
          title: tabs[0].title,
          isGoogleMaps: this.isGoogleMapsTab(tabs[0])
        });
      } else {
        sendResponse({ error: 'No active tab found' });
      }
    });
  }
}

// Initialize background script
try {
  new BackgroundScript();
  console.log('Background script initialized successfully');
} catch (error) {
  console.error('Error initializing background script:', error);
}