# Vibe Coded Google Maps Results Scraper

A Chrome extension that scrapes Google Maps search results with automatic pagination handling.

## Features

- 🗺️ **Smart Scraping**: Automatically detects and extracts Google Maps search results
- 📄 **Pagination Support**: Scrolls through all result pages to collect complete data
- ⚙️ **Configurable Settings**: Adjustable scroll delay and result limits
- 📊 **Multiple Export Formats**: JSON, CSV, and TXT export options
- 🎯 **Selective Operation**: Only works on Google Maps pages
- 📈 **Real-time Progress**: Live updates during scraping process
- 🛡️ **Safe Scrolling**: Intelligent scroll detection to avoid infinite loops

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the extension folder
5. The extension icon should appear in your Chrome toolbar

## Usage

1. **Navigate to Google Maps** (`maps.google.com`)
2. **Search for something** (e.g., "restaurants near me", "hotels in Paris")
3. **Click the extension icon** in your Chrome toolbar
4. **Configure settings** (optional):
   - Scroll Delay: Time between scroll actions (500-10000ms)
   - Max Results: Limit the number of results (0 = unlimited)
   - Export Format: Choose between JSON, CSV, or TXT
5. **Click "Start Scraping"** to begin the process
6. **Monitor progress** - the extension will automatically:
   - Scroll through all result pages
   - Extract business information
   - Handle pagination automatically
7. **Stop anytime** - click "Stop & Export" to halt scraping and keep all collected results
8. **Export your data** using the "Export Data" button

## Stopping Options

The scraper can stop in two ways:

### 🛑 **User-Initiated Stop**
- Click the "Stop & Export" button at any time during scraping
- All results collected up to that point will be preserved
- You can immediately export the partial dataset
- Useful when you have enough results or want to check progress

### 🏁 **Automatic Completion**
The scraper automatically stops when:
- No new results are found after multiple scroll attempts
- Maximum scroll attempts reached (safety limit)
- Maximum results limit reached (if configured)
- No more content available to scroll

## Extracted Data

The extension captures the following information for each business:

- **Name**: Business name
- **Rating**: Star rating (1-5)
- **Review Count**: Number of reviews
- **Address**: Physical address
- **Type**: Business category/type
- **Phone**: Phone number (if available)
- **Website**: Website URL (if available)
- **Hours**: Opening hours (if available)
- **Price Level**: Price range indicator ($ symbols)
- **Scraped At**: Timestamp of when data was collected

## Settings

### Scroll Delay
- **Default**: 2000ms (2 seconds)
- **Range**: 500ms - 10000ms
- **Purpose**: Time to wait between scroll actions for content to load
- **Tip**: Increase for slower internet connections

### Max Results
- **Default**: 0 (unlimited)
- **Purpose**: Stop scraping after reaching this number of results
- **Tip**: Set a limit for faster completion on large result sets

### Export Format
- **JSON**: Structured data format, best for programming
- **CSV**: Spreadsheet format, best for Excel/Google Sheets
- **TXT**: Plain text format, best for reading

## How It Works

### 1. Page Detection
The extension only activates on Google Maps pages (`maps.google.com` or `google.com/maps`)

### 2. Result Identification
Uses multiple CSS selectors to identify business result elements across different Google Maps layouts

### 3. Smart Scrolling
- Finds the scrollable results panel
- Scrolls incrementally to load more results
- Monitors for new content appearing
- Stops when no new results are found

### 4. Data Extraction
For each business result, the extension extracts:
- Text content using multiple selector strategies
- Structured data from aria-labels and data attributes
- Rating information from star elements
- Contact information from various UI elements

### 5. Duplicate Prevention
- Tracks processed elements to avoid duplicates
- Uses multiple identification methods (data attributes, content-based IDs)

## Troubleshooting

### Extension Not Working
- ✅ Make sure you're on a Google Maps page
- ✅ Ensure you have search results displayed
- ✅ Try refreshing the page and restarting the extension

### No Results Found
- ✅ Verify there are visible search results on the page
- ✅ Try searching for something with many results
- ✅ Check if you're in the correct Google Maps view (not satellite/terrain only)

### Scraping Stops Early
- ✅ Increase the scroll delay in settings
- ✅ Check your internet connection
- ✅ Some searches may have limited results
- ✅ Use "Stop & Export" to manually stop and keep current results

### Want to Stop Mid-Process
- ✅ Click "Stop & Export" button anytime during scraping
- ✅ All collected results will be preserved and available for export
- ✅ No data loss when stopping manually

### Export Issues
- ✅ Make sure you have scraped data before trying to export
- ✅ Check your browser's download settings
- ✅ Try a different export format

## Technical Details

### Architecture
- **Manifest V3**: Modern Chrome extension format
- **Content Script**: Runs on Google Maps pages for scraping
- **Background Script**: Manages extension lifecycle and messaging
- **Popup Interface**: User control panel

### Browser Compatibility
- Chrome 88+ (Manifest V3 support required)
- Edge 88+ (Chromium-based)

### Permissions
- `activeTab`: Access to current Google Maps tab
- `scripting`: Inject scraping scripts
- `storage`: Save user settings
- `host_permissions`: Access to Google Maps domains

## Privacy & Legal

### Data Handling
- All data processing happens locally in your browser
- No data is sent to external servers
- Scraped data is only exported when you choose to do so

### Legal Considerations
- This tool is for personal and educational use
- Respect Google's Terms of Service
- Be mindful of rate limiting and don't overload Google's servers
- Consider the robots.txt and website policies
- Use responsibly and ethically

### Rate Limiting
The extension includes built-in rate limiting:
- Configurable delays between actions
- Maximum scroll attempt limits
- Intelligent stopping when no new results are found

## Contributing

Feel free to contribute to this project by:
1. Reporting bugs or issues
2. Suggesting new features
3. Submitting pull requests
4. Improving documentation

## Version History

### v1.0.0
- Initial release
- Basic scraping functionality
- Pagination support
- Multiple export formats
- Configurable settings

## License

This project is for educational and personal use. Please respect Google's Terms of Service and use responsibly.

---

**Note**: This extension is not affiliated with Google. Google Maps is a trademark of Google LLC.
