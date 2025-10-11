// Popup script for the Google Maps Scraper extension
class MapsScraperPopup {
  constructor() {
    this.isScrapingActive = false;
    this.scrapedData = [];
    this.init();
  }

  init() {
    this.bindEvents();
    this.loadSettings();
    this.updateUI(); // Set initial button states
    this.checkCurrentTab();
  }

  bindEvents() {
    document.getElementById('startScraping').addEventListener('click', () => this.startScraping());
    document.getElementById('stopScraping').addEventListener('click', () => this.stopScraping());
    document.getElementById('exportData').addEventListener('click', () => this.exportData());
    
    // Save settings on change
    ['delay', 'maxResults', 'exportFormat'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => this.saveSettings());
    });
  }

  async checkCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const isGoogleMaps = tab.url.includes('maps.google.com') || 
                          (tab.url.includes('google.com/maps'));
      
      if (!isGoogleMaps) {
        this.updateStatus('Please navigate to Google Maps first', 'warning');
        document.getElementById('startScraping').disabled = true;
        document.getElementById('startScraping').classList.add('disabled');
      } else {
        // Check if there are search results
        const hasResults = await this.checkForSearchResults(tab.id);
        if (!hasResults) {
          this.updateStatus('No search results found. Please search for something on Google Maps.', 'warning');
          document.getElementById('startScraping').disabled = true;
          document.getElementById('startScraping').classList.add('disabled');
        } else {
          // Check if scraping is already active
          const isScrapingActive = await this.checkIfScrapingActive(tab.id);
          if (isScrapingActive) {
            this.isScrapingActive = true;
            this.updateUI();
            this.updateStatus('Scraping already in progress on this page');
          } else {
            this.updateStatus('Ready to scrape Google Maps results');
            document.getElementById('startScraping').disabled = false;
            document.getElementById('startScraping').classList.remove('disabled');
          }
        }
      }
    } catch (error) {
      console.error('Error checking current tab:', error);
      this.updateStatus('Error checking current page', 'error');
    }
  }

  async checkForSearchResults(tabId) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const searchResults = document.querySelectorAll('[data-result-index], .Nv2PK, [jsaction*="pane"], .bfdHYd');
          return searchResults.length > 0;
        }
      });
      return results[0]?.result || false;
    } catch (error) {
      console.error('Error checking for search results:', error);
      return false;
    }
  }

  async checkIfScrapingActive(tabId) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          return window.mapsScraperActive === true;
        }
      });
      return results[0]?.result || false;
    } catch (error) {
      console.error('Error checking scraping status:', error);
      return false;
    }
  }

  async startScraping() {
    try {
      // Check if already scraping
      if (this.isScrapingActive) {
        this.updateStatus('Scraping already in progress', 'warning');
        return;
      }

      this.isScrapingActive = true;
      this.updateUI();
      this.updateStatus('Starting scraper...');

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const settings = this.getSettings();

      // Inject the scraper script
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (settings) => {
          // This function runs in the context of the Google Maps page
          window.mapsScraperActive = true;
          window.mapsScraperSettings = settings;
          
          // Trigger the content script to start scraping
          window.dispatchEvent(new CustomEvent('startMapsScaping', { detail: settings }));
        },
        args: [settings]
      });

      // Listen for updates from content script
      this.listenForUpdates();

    } catch (error) {
      console.error('Error starting scraper:', error);
      this.updateStatus('Error starting scraper: ' + error.message, 'error');
      this.stopScraping();
    }
  }

  stopScraping() {
    this.isScrapingActive = false;
    this.updateUI();
    this.updateStatus('Stopping scraper...');
    
    // Send stop message to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'stopScraping' }, (response) => {
          // Handle the response with current results
          if (response && response.results) {
            this.handleScrapingComplete({
              results: response.results,
              stoppedByUser: true
            });
          }
        });
      }
    });
  }

  listenForUpdates() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'scrapingUpdate') {
        this.handleScrapingUpdate(message.data);
      } else if (message.action === 'scrapingComplete') {
        this.handleScrapingComplete(message.data);
      } else if (message.action === 'scrapingError') {
        this.handleScrapingError(message.error);
      } else if (message.action === 'scrapingStopped') {
        // Handle when scraping is stopped and get current results
        this.handleScrapingComplete({
          results: message.data.results,
          stoppedByUser: true
        });
      }
    });
  }

  handleScrapingUpdate(data) {
    this.scrapedData = data.results;
    this.updateStatus(`Scraping... Found ${data.results.length} results (Auto-saving every 10s)`);
    this.updateProgress(data.progress);
    document.getElementById('resultsCount').textContent = `Results found: ${data.results.length}`;
  }

  handleScrapingComplete(data) {
    this.scrapedData = data.results;
    this.isScrapingActive = false;
    this.updateUI();
    
    const message = data.stoppedByUser 
      ? `Scraping stopped by user! Collected ${data.results.length} results - File downloaded`
      : `Scraping complete! Found ${data.results.length} results - File downloaded`;
    
    this.updateStatus(message);
    this.updateProgress(100);
    document.getElementById('resultsCount').textContent = `Results found: ${data.results.length}`;
    document.getElementById('exportData').disabled = false;
    
    // Reset scraper state for next run
    this.resetScraperState();
  }

  handleScrapingError(error) {
    this.isScrapingActive = false;
    this.updateUI();
    this.updateStatus('Scraping error: ' + error, 'error');
  }

  updateUI() {
    const startBtn = document.getElementById('startScraping');
    const stopBtn = document.getElementById('stopScraping');
    const exportBtn = document.getElementById('exportData');
    
    if (this.isScrapingActive) {
      // Scraping is active
      startBtn.disabled = true;
      startBtn.classList.add('disabled');
      stopBtn.disabled = false;
      stopBtn.classList.remove('disabled');
      exportBtn.disabled = true;
      exportBtn.classList.add('disabled');
    } else {
      // Scraping is not active
      startBtn.disabled = false;
      startBtn.classList.remove('disabled');
      stopBtn.disabled = true;
      stopBtn.classList.add('disabled');
      
      // Export button enabled only if we have data
      if (this.scrapedData.length > 0) {
        exportBtn.disabled = false;
        exportBtn.classList.remove('disabled');
      } else {
        exportBtn.disabled = true;
        exportBtn.classList.add('disabled');
      }
    }
  }

  updateStatus(message, type = 'info') {
    const statusText = document.getElementById('statusText');
    statusText.textContent = message;
    statusText.className = `status-text ${type}`;
  }

  updateProgress(percentage) {
    document.getElementById('progressFill').style.width = percentage + '%';
  }

  getSettings() {
    return {
      delay: parseInt(document.getElementById('delay').value) || 2000,
      maxResults: parseInt(document.getElementById('maxResults').value) || 0,
      exportFormat: document.getElementById('exportFormat').value
    };
  }

  saveSettings() {
    const settings = this.getSettings();
    chrome.storage.local.set({ scraperSettings: settings });
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get('scraperSettings');
      if (result.scraperSettings) {
        const settings = result.scraperSettings;
        document.getElementById('delay').value = settings.delay || 2000;
        document.getElementById('maxResults').value = settings.maxResults || 0;
        document.getElementById('exportFormat').value = settings.exportFormat || 'json';
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  async exportData() {
    if (this.scrapedData.length === 0) {
      this.updateStatus('No data to export', 'warning');
      return;
    }

    const format = document.getElementById('exportFormat').value;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    let content, mimeType, extension;

    switch (format) {
      case 'json':
        content = JSON.stringify(this.scrapedData, null, 2);
        mimeType = 'application/json';
        extension = 'json';
        break;
      case 'csv':
        content = this.convertToCSV(this.scrapedData);
        mimeType = 'text/csv';
        extension = 'csv';
        break;
      case 'txt':
        content = this.convertToText(this.scrapedData);
        mimeType = 'text/plain';
        extension = 'txt';
        break;
    }

    this.downloadFile(content, `google-maps-results-${timestamp}.${extension}`, mimeType);
    this.updateStatus(`Exported ${this.scrapedData.length} results as ${format.toUpperCase()}`);
  }

  convertToCSV(data) {
    if (data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvHeaders = headers.join(',');
    
    const csvRows = data.map(row => {
      return headers.map(header => {
        const value = row[header] || '';
        // Escape quotes and wrap in quotes if contains comma or quote
        return typeof value === 'string' && (value.includes(',') || value.includes('"')) 
          ? `"${value.replace(/"/g, '""')}"` 
          : value;
      }).join(',');
    });

    return [csvHeaders, ...csvRows].join('\n');
  }

  convertToText(data) {
    return data.map((item, index) => {
      return `${index + 1}. ${item.name || 'Unknown'}\n` +
             `   Website: ${item.website || 'N/A'}\n` +
             `   Address: ${item.address || 'N/A'}\n` +
             `   Rating: ${item.rating || 'N/A'}\n` +
             `   Phone: ${item.phone || 'N/A'}\n` +
             `   Type: ${item.type || 'N/A'}\n\n`;
    }).join('');
  }

  downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    
    // Try using Chrome downloads API, fallback to direct download
    if (chrome.downloads) {
      chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: true
      }).catch((error) => {
        console.log('Chrome downloads API failed, using fallback:', error);
        this.fallbackDownload(url, filename);
      });
    } else {
      this.fallbackDownload(url, filename);
    }
  }

  fallbackDownload(url, filename) {
    // Fallback download method
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async resetScraperState() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        await chrome.tabs.sendMessage(tab.id, { action: 'resetScraper' });
        console.log('Scraper state reset successfully');
      }
    } catch (error) {
      console.log('Could not reset scraper state (this is normal if content script is not loaded):', error);
    }
  }
}

// Initialize the popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new MapsScraperPopup();
});