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
      '[aria-label*="Results for"]',
      '.Nv2PK.THOPZb.CpccDe'
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
        console.log('Skipping already processed element:', elementId);
        continue;
      }

      try {
        const resultData = await this.extractResultData(element);
        if (resultData && this.isValidResult(resultData)) {
          // Additional duplicate check by business name
          const isDuplicate = this.results.some(existing => 
            existing.name.toLowerCase().trim() === resultData.name.toLowerCase().trim() &&
            existing.address.toLowerCase().trim() === resultData.address.toLowerCase().trim()
          );
          
          if (isDuplicate) {
            console.log('Skipping duplicate business:', resultData.name);
            this.processedElements.add(elementId);
            continue;
          }
          
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
        
        // Add small delay between processing elements to avoid overwhelming the page
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        console.error('Error scraping result:', error);
      }
    }
  }

  findResultElements() {
    // Use the specific selector you prefer
    const selector = '.Nv2PK.THOPZb';
    // Nv2PK tH5CWc THOPZb
    // Nv2PK THOPZb CpccDe
    const elements = new Set();
    
    try {
      const found = document.querySelectorAll(selector);
      console.log(`Found ${found.length} elements with selector: ${selector}`);
      
      found.forEach(el => {
        const text = el.textContent.toLowerCase();
        
        // Skip sponsored/ad results
        const isSponsored = el.querySelector('[aria-label="Sponsored"]') || 
                           el.querySelector('[aria-label*="Sponsored"]') ||
                           text.includes('sponsored') ||
                           text.includes('advertisement') ||
                           el.querySelector('.jHLihd');
        
        if (!isSponsored) {
          elements.add(el);
        } else {
          console.log('Skipping sponsored result');
        }
      });
    } catch (error) {
      console.log('Selector failed:', selector, error);
    }
    
    console.log(`Returning ${elements.size} non-sponsored elements`);
    return Array.from(elements);
  }

  looksLikeBusinessResult(element) {
    // Check if element contains business-like content
    const text = element.textContent.toLowerCase();
    
    // Skip sponsored/ad results
    const isSponsored = element.querySelector('[aria-label="Sponsored"]') || 
                       element.querySelector('[aria-label*="Sponsored"]') ||
                       text.includes('sponsored') ||
                       text.includes('advertisement') ||
                       element.querySelector('.jHLihd'); // Common sponsored indicator class
    
    if (isSponsored) {
      console.log('Skipping sponsored/ad result');
      return false;
    }
    
    // Strong indicators of business listings
    const hasRating = element.querySelector('[role="img"][aria-label*="star"], .MW4etd, [aria-label*="rating"], [aria-label*="stars"]');
    const hasName = element.querySelector('.fontHeadlineSmall, .section-result-title, h3, [role="button"]');
    const hasAddress = text.includes('·') || text.includes(',') || element.querySelector('[data-value="Address"]');
    const hasWebsite = element.querySelector('a[href*="http"]:not([href*="google.com"]):not([href*="gstatic.com"])');
    const hasPhone = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(text);
    const hasDirections = element.querySelector('[data-value="Directions"]');
    
    // Hotel/restaurant specific indicators
    const hasBookingLink = element.querySelector('a[href*="booking"], a[href*="reservation"], a[href*="hotel"], a[href*="zenhotels"]');
    const hasHotelKeywords = /hotel|inn|resort|lodge|motel|hostel|b&b|bed and breakfast/i.test(text);
    const hasRestaurantKeywords = /restaurant|cafe|diner|bistro|eatery|food|cuisine/i.test(text);
    
    // Business type indicators
    const hasBusinessKeywords = /agency|company|service|office|shop|store|center|clinic|salon/i.test(text);
    
    // Minimum requirements for a business result
    const hasBasicInfo = hasName && (hasRating || hasAddress || hasWebsite || hasPhone);
    const hasBusinessIndicators = hasDirections || hasBookingLink || hasHotelKeywords || hasRestaurantKeywords || hasBusinessKeywords;
    
    // Additional quality checks
    const hasReasonableTextLength = text.length > 20 && text.length < 5000;
    const notLoadingOrError = !text.includes('loading') && !text.includes('error') && !text.includes('search');
    
    return hasBasicInfo && hasBusinessIndicators && hasReasonableTextLength && notLoadingOrError;
  }

  getElementId(element) {
    // Create a unique identifier for the element
    const dataId = element.getAttribute('data-result-index') ||
                  element.getAttribute('data-feature-id') ||
                  element.getAttribute('data-fid');
    
    if (dataId) {
      return dataId;
    }
    
    // Use business name + address combination for unique ID
    const nameElement = element.querySelector('.fontHeadlineSmall, .section-result-title, h3, [role="button"], .qBF1Pd');
    const name = nameElement ? nameElement.textContent.trim() : '';
    
    // Try to get address for more uniqueness
    const addressElement = element.querySelector('.W4Efsd, [data-value="Address"]');
    const address = addressElement ? addressElement.textContent.trim() : '';
    
    // Create a more unique identifier using name + partial address
    const uniqueId = `${name}_${address.substring(0, 20)}`.replace(/[^a-zA-Z0-9_]/g, '_');
    return uniqueId || `element_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
      const website = await this.extractWebsite(element);
      
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

  async extractWebsite(element) {
    console.log('Extracting website for element:');
    // Try multiple selectors for different business types and layouts
    const websiteSelectors = [
      // Standard website links
      'a[href*="http"]:not([href*="google.com"]):not([href*="maps.google"])',
      
      // Hotel booking links (like ZenHotels, Booking.com, etc.)
      'a.xhX3nf[href*="http"]',
      'a[data-url*="http"]',
      
      // Business website links
      '[data-value="Website"] a',
      '[aria-label*="Website"] a',
      
      // Review platform links that might lead to business sites
      'a[href*="http"]:not([href*="google.com"]):not([href*="gstatic.com"]):not([href*="googleusercontent.com"])',
      
      // Booking and reservation links
      'a[href*="booking"]',
      'a[href*="reservation"]',
      'a[href*="hotel"]',
      'a[href*="restaurant"]',
      
      // Social media and business directory links
      'a[href*="facebook.com"]',
      'a[href*="instagram.com"]',
      'a[href*="linkedin.com"]',
      'a[href*="yelp.com"]',
      'a[href*="tripadvisor.com"]'
    ];

    let fallbackUrl = null;

    for (const selector of websiteSelectors) {
      const linkElements = element.querySelectorAll(selector);
      
      for (const link of linkElements) {
        let url = link.href || link.getAttribute('data-url') || link.getAttribute('data-href');
        
        if (url) {
          // Clean up the URL
          url = url.trim();
          
          // Skip Google-related URLs
          if (url.includes('google.com') || 
              url.includes('gstatic.com') || 
              url.includes('googleusercontent.com') ||
              url.includes('maps.google') ||
              url.startsWith('javascript:') ||
              url.startsWith('tel:') ||
              url.startsWith('mailto:')) {
            continue;
          }
          
          // Prefer direct business websites over booking platforms
          if (this.isDirectBusinessWebsite(url)) {
            return url;
          }
          
          // Store booking/platform URLs as fallback
          if (this.isValidBusinessURL(url)) {
            // Continue looking for better URLs, but keep this as fallback
            fallbackUrl = url;
          }
        }
      }
    }
    
    // If no website found in current view, try clicking the business to open modal
    if (!fallbackUrl) {
      try {
        const businessName = element.querySelector('.qBF1Pd, .fontHeadlineSmall, [class*="headline"]')?.textContent?.trim();
        const clickableElement = element.querySelector('.hfpxzc, [jsaction*="pane.wfvdle"], button[aria-label*="' + businessName + '"]');
        
        if (clickableElement && businessName) {
          console.log(`Clicking ${businessName} to check for website in modal...`);
          
          // Click the element to open modal
          clickableElement.click();
          
          // Wait for modal to load
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Try to extract website from the modal
          const modal = document.querySelector('.bJzME, .k7jAl, [role="main"][aria-label*="' + businessName + '"], .m6QErb.XiKgde.tLjsW.UhIuC');
          if (modal) {
            // First try the most reliable method - Website aria-label
            const websiteAnchor = document.querySelector('[aria-label*="Website:"]');
            console.log('anchor', websiteAnchor);
            if (websiteAnchor && websiteAnchor.href) {
              const url = websiteAnchor.href;
              if (url && this.isValidBusinessURL(url) && !url.includes('google.com/search')) {
                console.log(`Found website via aria-label in modal: ${url}`);
                await this.closeModal(modal);
                return url.trim();
              }
            }
            
            // Fallback: Look for website in modal using other selectors
            const modalSelectors = [
              // Direct website link
              'a[data-item-id="authority"]',
              '.CsEnBe[data-item-id="authority"]',
              '.RcCsl[data-item-id="authority"] a',
              
              // Website links in modal
              'a[href*="://"]:not([href*="google.com"]):not([href*="maps"]):not([href*="gstatic"])',
              '[aria-label*="Website"] a',
              'a[target="_blank"]:not([href*="google.com"])',
              'a[jsaction*="website"]',
              
              // Hotel specific booking links
              'a[href*="hotel"]',
              'a[href*="booking"]',
              'a.SlvSdc[href*="http"]',
              
              // Look for text content that might be a website
              '.Io6YTe.fontBodyMedium.kR99db.fdkmkc'
            ];
            
            for (const selector of modalSelectors) {
              const links = modal.querySelectorAll(selector);
              for (const link of links) {
                let url = link.href || link.getAttribute('href') || link.textContent;
                
                // Clean the URL if it's just text content
                if (url && !url.startsWith('http') && url.includes('.')) {
                  // If it looks like a domain, add https://
                  if (url.match(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)) {
                    url = 'https://' + url;
                  }
                }
                
                if (url && this.isValidBusinessURL(url) && !url.includes('google.com')) {
                  console.log(`Found website in modal: ${url}`);
                  
                  // Close modal
                  await this.closeModal(modal);
                  return url.trim();
                }
              }
            }
            
            // Close modal if no website found
            await this.closeModal(modal);
          }
        }
      } catch (error) {
        console.log('Error extracting website from modal:', error);
      }
    }
    
    // Return fallback URL if found (booking sites, social media, etc.)
    return fallbackUrl || null;
  }

  async closeModal(modal) {
    try {
      // Try multiple ways to close the modal
      const closeButton = modal.querySelector('[aria-label="Close"], .VfPpkd-icon-LgbsSe, [jsaction*="close"]');
      if (closeButton) {
        closeButton.click();
      } else {
        // Press escape key
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          keyCode: 27,
          charCode: 27,
          bubbles: true
        }));
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.log('Error closing modal:', error);
    }
  }

  isDirectBusinessWebsite(url) {
    const directIndicators = [
      // Common business website patterns
      /^https?:\/\/(?:www\.)?[^\/]+\.(com|org|net|co|biz|info|restaurant|hotel)(?:\/|$)/i,
      // Avoid booking platforms
      !/booking|tripadvisor|yelp|opentable|zenhotels|expedia|hotels\.com/i.test(url)
    ];
    
    return directIndicators.every(test => {
      if (test instanceof RegExp) {
        return test.test(url);
      }
      return test;
    });
  }

  isValidBusinessURL(url) {
    // Check if URL looks like a valid business-related URL
    return url.startsWith('http') && 
           url.length > 10 && 
           !url.includes('javascript') &&
           !url.includes('google.com/search');
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