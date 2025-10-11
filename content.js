// Content script for Google Maps scraping
class GoogleMapsScraper {
  constructor() {
    this.isActive = false;
    this.results = [];
    this.processedElements = new Set();
    this.settings = {
      delay: 2000,
      maxResults: 0
    };
    this.scrollAttempts = 0;
    this.maxScrollAttempts = 50;
    this.lastResultCount = 0;
    this.noNewResultsCount = 0;
    this.maxNoNewResults = 3;
    this.autoSaveInterval = null;
    
    this.init();
  }

  init() {
    this.bindEvents();
    this.setupMutationObserver();
  }

  bindEvents() {
    // Listen for start scraping event from popup
    window.addEventListener('startMapsScaping', (event) => {
      this.settings = { ...this.settings, ...event.detail };
      this.startScraping();
    });

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      try {
        if (message.action === 'stopScraping') {
          this.stopScrapingByUser();
          // Send current results back to popup
          sendResponse({
            results: this.results,
            total: this.results.length
          });
        } else if (message.action === 'resetScraper') {
          this.resetScraperState();
          sendResponse({ success: true });
        }
      } catch (error) {
        console.error('Error in content script message listener:', error);
        sendResponse({ error: error.message });
      }
    });
  }

  setupMutationObserver() {
    // Watch for new content being loaded
    this.observer = new MutationObserver((mutations) => {
      if (this.isActive) {
        // Debounce the scraping to avoid too frequent updates
        clearTimeout(this.scrapingTimeout);
        this.scrapingTimeout = setTimeout(() => {
          this.scrapeVisibleResults();
        }, 500);
      }
    });
  }

  async startScraping() {
    if (this.isActive) {
      console.log('Scraping already active');
      return;
    }

    console.log('Starting Google Maps scraping with settings:', this.settings);
    this.isActive = true;
    this.results = [];
    this.processedElements.clear();
    this.scrollAttempts = 0;
    this.noNewResultsCount = 0;

    // Check extension context before starting
    if (!this.isExtensionContextValid()) {
      console.log('Extension context invalid - cannot start scraping');
      return;
    }

    // Start auto-saving results every 10 seconds
    this.startAutoSave();

    // Start observing DOM changes
    const targetNode = document.body;
    this.observer.observe(targetNode, {
      childList: true,
      subtree: true
    });

    // Initial scrape
    await this.scrapeVisibleResults();
    
    // Start scrolling process
    this.startScrolling();
  }

  stopScraping() {
    console.log('Stopping scraper - no more results available');
    this.isActive = false;
    
    if (this.observer) {
      this.observer.disconnect();
    }
    
    clearTimeout(this.scrollTimeout);
    clearTimeout(this.scrapingTimeout);
    this.stopAutoSave();

    // Reset scraper state for next run
    this.resetScraperState();

    // Save final results and trigger download
    this.saveResultsToFile(true);
    
    // Only send message if extension context is valid
    if (this.isExtensionContextValid()) {
      this.sendMessage('scrapingComplete', {
        results: this.results,
        total: this.results.length,
        stoppedByUser: false
      });
    } else {
      console.log('Extension context invalid - cannot send completion message');
    }
  }

  stopScrapingByUser() {
    console.log('Stopping scraper - user requested stop');
    this.isActive = false;
    
    if (this.observer) {
      this.observer.disconnect();
    }
    
    clearTimeout(this.scrollTimeout);
    clearTimeout(this.scrapingTimeout);
    this.stopAutoSave();

    // Reset scraper state for next run
    this.resetScraperState();

    // Save final results and trigger download
    this.saveResultsToFile(true);
    
    // Only send message if extension context is valid
    if (this.isExtensionContextValid()) {
      this.sendMessage('scrapingStopped', {
        results: this.results,
        total: this.results.length,
        stoppedByUser: true
      });
    } else {
      console.log('Extension context invalid - cannot send stop message');
    }
  }

  async startScrolling() {
    if (!this.isActive) return;

    const resultsPanel = this.findResultsPanel();
    if (!resultsPanel) {
      console.error('Could not find results panel for scrolling');
      this.stopScraping();
      return;
    }

    await this.scrollAndScrape(resultsPanel);
  }

  async scrollAndScrape(resultsPanel) {
    if (!this.isActive) return;

    // Check if extension context is still valid
    if (!this.isExtensionContextValid()) {
      console.log('Extension context invalidated - stopping scraper');
      this.stopScraping();
      return;
    }

    const beforeScrollCount = this.results.length;
    
    // Scroll to bottom of results panel
    resultsPanel.scrollTop = resultsPanel.scrollHeight;
    
    console.log(`Scroll attempt ${this.scrollAttempts + 1}, current results: ${this.results.length}`);
    
    // Wait for content to load
    await this.wait(this.settings.delay);
    
    if (!this.isActive) return;

    // Scrape any new results that appeared
    await this.scrapeVisibleResults();
    
    const afterScrollCount = this.results.length;
    const newResults = afterScrollCount - beforeScrollCount;
    
    console.log(`Found ${newResults} new results after scroll`);
    
    // Update progress
    this.sendMessage('scrapingUpdate', {
      results: this.results,
      progress: Math.min((this.scrollAttempts / this.maxScrollAttempts) * 100, 95)
    });

    // Check if we should continue scrolling
    if (newResults === 0) {
      this.noNewResultsCount++;
    } else {
      this.noNewResultsCount = 0;
    }

    this.scrollAttempts++;
    
    // Stop conditions
    const shouldStop = 
      this.noNewResultsCount >= this.maxNoNewResults ||
      this.scrollAttempts >= this.maxScrollAttempts ||
      (this.settings.maxResults > 0 && this.results.length >= this.settings.maxResults) ||
      !this.hasMoreResults(resultsPanel);

    if (shouldStop) {
      console.log('Stopping scrolling. Reason:', {
        noNewResults: this.noNewResultsCount >= this.maxNoNewResults,
        maxAttempts: this.scrollAttempts >= this.maxScrollAttempts,
        maxResults: this.settings.maxResults > 0 && this.results.length >= this.settings.maxResults,
        noMoreResults: !this.hasMoreResults(resultsPanel)
      });
      this.stopScraping(); // Natural completion
    } else {
      // Continue scrolling
      this.scrollTimeout = setTimeout(() => {
        this.scrollAndScrape(resultsPanel);
      }, 1000);
    }
  }

  hasMoreResults(resultsPanel) {
    // Check if there's more content to load by looking for loading indicators
    const loadingIndicators = resultsPanel.querySelectorAll('[data-value="Searching"]', '.loading', '[aria-label*="Loading"]');
    if (loadingIndicators.length > 0) {
      return true;
    }

    // Check if we can scroll more
    const isScrolledToBottom = resultsPanel.scrollTop + resultsPanel.clientHeight >= resultsPanel.scrollHeight - 10;
    return !isScrolledToBottom;
  }

  findResultsPanel() {
    // Try different selectors for the results panel
    const selectors = [
      '[role="main"] [role="region"]',
      '[data-test-id="results-pane"]',
      '.m6QErb[data-id="pane"]',
      '[jsaction*="pane.resultList"]',
      '.Nv2PK',
      '.section-scrollbox',
      '[aria-label*="Results for"]'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.scrollHeight > element.clientHeight) {
        console.log('Found results panel with selector:', selector);
        return element;
      }
    }

    // Fallback: find scrollable container with results
    const scrollableElements = document.querySelectorAll('*');
    for (const element of scrollableElements) {
      if (element.scrollHeight > element.clientHeight && 
          element.querySelector('[data-result-index], .bfdHYd, [jsaction*="pane"]')) {
        console.log('Found results panel via fallback method');
        return element;
      }
    }

    console.error('Could not find results panel');
    return null;
  }

  async scrapeVisibleResults() {
    if (!this.isActive) return;

    // Check if extension context is still valid
    if (!this.isExtensionContextValid()) {
      console.log('Extension context invalidated - stopping scraper');
      this.stopScraping();
      return;
    }

    const resultElements = this.findResultElements();
    console.log(`Found ${resultElements.length} result elements on page`);

    for (const element of resultElements) {
      if (!this.isActive) break;
      
      const elementId = this.getElementId(element);
      if (this.processedElements.has(elementId)) {
        continue;
      }

      try {
        const resultData = await this.extractResultData(element);
        if (resultData && this.isValidResult(resultData)) {
          this.results.push(resultData);
          this.processedElements.add(elementId);
          
          console.log(`Scraped result ${this.results.length}:`, resultData.name);
          
          // Check if we've reached the max results limit
          if (this.settings.maxResults > 0 && this.results.length >= this.settings.maxResults) {
            console.log('Reached maximum results limit');
            this.stopScraping(); // Natural completion
            return;
          }
        }
      } catch (error) {
        console.error('Error scraping result:', error);
      }
    }
  }

  findResultElements() {
    // Multiple selectors to find result elements across different Google Maps layouts
    const selectors = [
      '[data-result-index]',
      '.bfdHYd',
      '[jsaction*="pane.resultList.click"]',
      '[data-feature-id]',
      '.Nv2PK .TFQHme',
      '[role="article"]',
      '.section-result',
      '.section-result-content',
      '[aria-label][data-value="Directions"]'
    ];

    const elements = new Set();
    
    for (const selector of selectors) {
      const found = document.querySelectorAll(selector);
      found.forEach(el => {
        // Only add if it looks like a business result
        if (this.looksLikeBusinessResult(el)) {
          elements.add(el);
        }
      });
    }

    return Array.from(elements);
  }

  looksLikeBusinessResult(element) {
    // Check if element contains business-like content
    const text = element.textContent.toLowerCase();
    const hasRating = element.querySelector('[role="img"][aria-label*="star"], .MW4etd, [aria-label*="rating"]');
    const hasName = element.querySelector('.fontHeadlineSmall, .section-result-title, h3, [role="button"]');
    const hasAddress = text.includes('·') || text.includes(',') || element.querySelector('[data-value="Address"]');
    
    return (hasName && (hasRating || hasAddress)) || 
           (element.querySelector('[data-value="Directions"]') && hasName);
  }

  getElementId(element) {
    // Create a unique identifier for the element
    return element.getAttribute('data-result-index') ||
           element.getAttribute('data-feature-id') ||
           element.getAttribute('data-fid') ||
           this.getTextBasedId(element);
  }

  getTextBasedId(element) {
    // Use the business name as ID if no other identifier exists
    const nameElement = element.querySelector('.fontHeadlineSmall, .section-result-title, h3, [role="button"]');
    const name = nameElement ? nameElement.textContent.trim() : '';
    const position = Array.from(element.parentNode.children).indexOf(element);
    return `${name}_${position}`.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  async extractResultData(element) {
    try {
      // Extract business name
      const name = this.extractName(element);
      
      // Extract rating
      const rating = this.extractRating(element);
      
      // Extract address
      const address = this.extractAddress(element);
      
      // Extract business type/category
      const type = this.extractType(element);
      
      // Extract phone number
      const phone = this.extractPhone(element);
      
      // Extract website
      const website = this.extractWebsite(element);
      
      // Extract opening hours
      const hours = this.extractHours(element);
      
      // Extract price level
      const priceLevel = this.extractPriceLevel(element);
      
      // Extract number of reviews
      const reviewCount = this.extractReviewCount(element);

      // Get additional data by clicking if needed
      const additionalData = await this.getAdditionalData(element);

      return {
        name: name || 'Unknown',
        website: website || '',
        rating: rating,
        reviewCount: reviewCount,
        address: address || '',
        type: type || '',
        phone: phone || '',
        hours: hours || '',
        priceLevel: priceLevel || '',
        scrapedAt: new Date().toISOString(),
        ...additionalData
      };
    } catch (error) {
      console.error('Error extracting result data:', error);
      return null;
    }
  }

  extractName(element) {
    const selectors = [
      '.fontHeadlineSmall',
      '.section-result-title',
      'h3',
      '[role="button"] .fontHeadlineSmall',
      '.qBF1Pd',
      '.DUwDvf'
    ];

    for (const selector of selectors) {
      const nameElement = element.querySelector(selector);
      if (nameElement && nameElement.textContent.trim()) {
        return nameElement.textContent.trim();
      }
    }

    // Fallback: try to find the largest text element
    const textElements = element.querySelectorAll('*');
    let largestText = '';
    for (const el of textElements) {
      const text = el.textContent.trim();
      if (text.length > largestText.length && text.length < 100) {
        largestText = text;
      }
    }

    return largestText;
  }

  extractRating(element) {
    const ratingSelectors = [
      '[role="img"][aria-label*="star"]',
      '.MW4etd',
      '[aria-label*="rating"]',
      '.section-result-rating',
      '[aria-label*="stars"]'
    ];

    for (const selector of ratingSelectors) {
      const ratingElement = element.querySelector(selector);
      if (ratingElement) {
        const ariaLabel = ratingElement.getAttribute('aria-label') || '';
        const match = ariaLabel.match(/(\d+(?:\.\d+)?)/);
        if (match) {
          return parseFloat(match[1]);
        }
        
        const text = ratingElement.textContent.trim();
        const textMatch = text.match(/(\d+(?:\.\d+)?)/);
        if (textMatch) {
          return parseFloat(textMatch[1]);
        }
      }
    }

    // Look for rating in text content
    const text = element.textContent;
    const ratingMatch = text.match(/(\d+\.\d+)\s*star/i) || text.match(/(\d+\.\d+)\s*★/);
    return ratingMatch ? parseFloat(ratingMatch[1]) : null;
  }

  extractAddress(element) {
    const addressSelectors = [
      '[data-value="Address"]',
      '.section-result-location',
      '.section-result-details > div:nth-child(2)',
      '.W4Efsd:last-child',
      '.W4Efsd .W4Efsd'
    ];

    for (const selector of addressSelectors) {
      const addressElement = element.querySelector(selector);
      if (addressElement && addressElement.textContent.trim()) {
        return addressElement.textContent.trim();
      }
    }

    // Look for address patterns in text
    const text = element.textContent;
    const addressPattern = /\d+.*?(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Circle|Cir|Court|Ct)/i;
    const match = text.match(addressPattern);
    return match ? match[0].trim() : null;
  }

  extractType(element) {
    const typeSelectors = [
      '.section-result-details > div:first-child',
      '.W4Efsd:first-child',
      '[aria-label*="Category"]'
    ];

    for (const selector of typeSelectors) {
      const typeElement = element.querySelector(selector);
      if (typeElement && typeElement.textContent.trim()) {
        const text = typeElement.textContent.trim();
        // Skip if it looks like an address or rating
        if (!text.match(/\d+.*?(street|avenue|road|stars?)/i)) {
          return text;
        }
      }
    }

    return null;
  }

  extractPhone(element) {
    const phonePattern = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
    const text = element.textContent;
    const match = text.match(phonePattern);
    return match ? match[0] : null;
  }

  extractWebsite(element) {
    const websiteElement = element.querySelector('a[href*="http"]');
    return websiteElement ? websiteElement.href : null;
  }

  extractHours(element) {
    const hoursPattern = /(open|closed|\d{1,2}:\d{2}\s*(am|pm))/i;
    const text = element.textContent;
    const match = text.match(hoursPattern);
    return match ? match[0] : null;
  }

  extractPriceLevel(element) {
    const pricePattern = /\$+/;
    const text = element.textContent;
    const match = text.match(pricePattern);
    return match ? match[0] : null;
  }

  extractReviewCount(element) {
    const reviewPattern = /\((\d+(?:,\d+)*)\)/;
    const text = element.textContent;
    const match = text.match(reviewPattern);
    return match ? parseInt(match[1].replace(/,/g, '')) : null;
  }

  async getAdditionalData(element) {
    // This method could be extended to click on elements and extract more data
    // For now, return empty object to avoid complications
    return {};
  }

  isValidResult(result) {
    // Check if the result has meaningful data
    return result && 
           result.name && 
           result.name !== 'Unknown' && 
           result.name.length > 1 &&
           !result.name.toLowerCase().includes('loading') &&
           !result.name.toLowerCase().includes('search');
  }

  sendMessage(action, data) {
    try {
      // Check if extension context is still valid
      if (!chrome.runtime || !chrome.runtime.id) {
        console.log('Extension context invalidated - stopping scraper');
        this.stopScraping();
        return;
      }

      if (chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          action: action,
          data: data
        }).catch((error) => {
          if (error.message && error.message.includes('Extension context invalidated')) {
            console.log('Extension context invalidated during message sending - stopping scraper');
            this.stopScraping();
          } else {
            console.log('Message sending failed (this is normal if popup is closed):', error);
          }
        });
      }
    } catch (error) {
      if (error.message && error.message.includes('Extension context invalidated')) {
        console.log('Extension context invalidated - stopping scraper');
        this.stopScraping();
      } else {
        console.error('Error sending message:', error);
      }
    }
  }

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  isExtensionContextValid() {
    try {
      return chrome.runtime && chrome.runtime.id;
    } catch (error) {
      return false;
    }
  }

  startAutoSave() {
    // Auto-save results every 10 seconds
    this.autoSaveInterval = setInterval(() => {
      if (this.isActive && this.results.length > 0) {
        this.saveResultsToFile(false);
      }
    }, 10000);
  }

  stopAutoSave() {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
  }

  saveResultsToFile(triggerDownload = false) {
    if (this.results.length === 0) {
      console.log('No results to save');
      return;
    }

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      // Always save JSON to localStorage for backup
      const backupContent = JSON.stringify({
        scrapedAt: new Date().toISOString(),
        totalResults: this.results.length,
        searchQuery: this.extractSearchQuery(),
        results: this.results
      }, null, 2);
      
      localStorage.setItem('googleMapsScraperResults', backupContent);
      localStorage.setItem('googleMapsScraperTimestamp', timestamp);

      console.log(`Saved ${this.results.length} results to localStorage`);

      if (triggerDownload) {
        // Get the selected format from settings or default to JSON
        const format = this.settings.exportFormat || 'json';
        let content, mimeType, extension;

        switch (format) {
          case 'json':
            content = backupContent;
            mimeType = 'application/json';
            extension = 'json';
            break;
          case 'csv':
            content = this.convertToCSV(this.results);
            mimeType = 'text/csv';
            extension = 'csv';
            break;
          case 'txt':
            content = this.convertToText(this.results);
            mimeType = 'text/plain';
            extension = 'txt';
            break;
          default:
            content = backupContent;
            mimeType = 'application/json';
            extension = 'json';
        }

        const filename = `google-maps-results-${timestamp}.${extension}`;
        this.downloadFile(content, filename, mimeType);
      }
    } catch (error) {
      console.error('Error saving results:', error);
    }
  }

  extractSearchQuery() {
    try {
      // Try to extract search query from the URL or page
      const url = window.location.href;
      const queryMatch = url.match(/search\/([^\/]+)/);
      if (queryMatch) {
        return decodeURIComponent(queryMatch[1]);
      }
      
      // Try to get from search input
      const searchInput = document.querySelector('input[aria-label*="Search"]');
      if (searchInput && searchInput.value) {
        return searchInput.value;
      }

      return 'Unknown search';
    } catch (error) {
      return 'Unknown search';
    }
  }

  downloadFile(content, filename, mimeType) {
    try {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      URL.revokeObjectURL(url);
      
      console.log(`Downloaded file: ${filename}`);
    } catch (error) {
      console.error('Error downloading file:', error);
    }
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

  resetScraperState() {
    // Reset all state variables for a fresh start
    window.mapsScraperActive = false;
    this.isActive = false;
    this.scrollAttempts = 0;
    this.noNewResultsCount = 0;
    this.lastResultCount = 0;
    this.processedElements.clear();
    
    // Clear any remaining timeouts
    clearTimeout(this.scrollTimeout);
    clearTimeout(this.scrapingTimeout);
    this.stopAutoSave();
    
    console.log('Scraper state reset - ready for next run');
  }
}

// Initialize the scraper when the page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new GoogleMapsScraper();
  });
} else {
  new GoogleMapsScraper();
}