import xml2js from "xml2js";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const getBrowser = async () => {
  // For development
  if (process.env.NODE_ENV === "development") {
    return puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      executablePath:
        process.platform === "win32"
          ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
          : process.platform === "darwin"
          ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
          : "/usr/bin/google-chrome",
    });
  }

  // For production deployment: Ubuntu 22.04.5 LTS (aarch64)
  // Installed by:
  // sudo apt install -y chromium-browser
  const executablePath = "/snap/bin/chromium";

  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: executablePath,
    headless: chromium.headless,
  });
};

async function scrapeChannelInfo(channelName: string) {
  const browser = await getBrowser();

  try {
    const page = await browser.newPage();

    // Set user agent to avoid detection
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
    );

    // Set viewport
    await page.setViewport({ width: 1280, height: 720 });

    console.log(`Navigating to: https://www.youtube.com/@${channelName}`);

    // Navigate to the channel page
    const response = await page.goto(
      `https://www.youtube.com/@${channelName}`,
      {
        waitUntil: "networkidle0",
        timeout: 30000,
      }
    );

    // Check if page was found
    if (response?.status() === 404) {
      throw new Error(`Channel not found: ${channelName}`);
    }

    // Wait for any of these selectors to appear
    try {
      await Promise.race([
        page.waitForSelector('meta[property="og:url"]', { timeout: 15000 }),
        page.waitForSelector('link[rel="canonical"]', { timeout: 15000 }),
        page.waitForSelector('meta[itemprop="channelId"]', { timeout: 15000 }),
      ]);
    } catch (error) {
      console.log("Timeout waiting for selectors, checking URL...");
      // If selectors aren't found, try to get info from URL
      const currentUrl = page.url();
      if (currentUrl.includes("/channel/")) {
        const channelId = currentUrl.split("/channel/")[1].split("/")[0];
        const title = await page.title();
        return {
          success: true,
          data: {
            author: title || channelName,
            uri: currentUrl,
            title: title || channelName,
            thumbnail: null,
            viewCount: 0,
            lastVideoId: null,
            lastVideoDate: null,
            channelId,
          },
        };
      }
      throw error;
    }

    // Extract channel info with fallbacks
    const channelInfo = await page.evaluate(() => {
      const getMetaContent = (selector: string) =>
        document.querySelector(selector)?.getAttribute("content");

      const url =
        getMetaContent('meta[property="og:url"]') ||
        document.querySelector('link[rel="canonical"]')?.getAttribute("href") ||
        window.location.href;

      const title =
        getMetaContent('meta[property="og:title"]') ||
        getMetaContent('meta[name="title"]') ||
        document.title;

      const image =
        getMetaContent('meta[property="og:image"]') ||
        getMetaContent('meta[name="thumbnail"]');

      return { url, title, image };
    });

    if (!channelInfo.url) {
      throw new Error("Could not find channel URL");
    }

    // Extract channel ID from URL
    const channelId = channelInfo.url.includes("/channel/")
      ? channelInfo.url.split("/channel/")[1].split("/")[0]
      : channelInfo.url.split("/").pop();

    console.log("Successfully scraped channel info:", channelInfo);

    return {
      success: true,
      data: {
        author: channelInfo.title || channelName,
        uri: channelInfo.url,
        title: channelInfo.title || channelName,
        thumbnail: channelInfo.image || null,
        viewCount: 0,
        lastVideoId: null,
        lastVideoDate: null,
        channelId,
      },
    };
  } catch (error) {
    console.error("Scraping error:", error);
    throw new Error(
      `Failed to scrape channel info: ${(error as Error).message}`
    );
  } finally {
    await browser.close();
  }
}

async function extractChannelIdFromHtml(channelName: string) {
  try {
    const response = await fetch(`https://www.youtube.com/@${channelName}`);

    if (response.status === 404) {
      throw new Error(`Channel not found: ${channelName}`);
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch channel page: ${response.status}`);
    }

    const html = await response.text();

    // First try to get channel ID from og:url
    const ogUrlMatch = html.match(/<meta property="og:url" content="([^"]+)"/);
    let channelId;

    if (ogUrlMatch && ogUrlMatch[1].includes("/channel/")) {
      channelId = ogUrlMatch[1].split("/channel/")[1].split("/")[0];
    } else {
      // Fallback to searching in the HTML
      const channelIdMatch = html.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/);
      if (!channelIdMatch) {
        throw new Error("Channel ID not found in page HTML");
      }
      channelId = channelIdMatch[1];
    }

    // Use og:url as canonical URL if available
    const url =
      ogUrlMatch?.[1] || `https://www.youtube.com/channel/${channelId}`;

    // Extract title (try multiple patterns)
    let title = channelName;
    const titlePatterns = [
      /<meta name="title" content="([^"]+)"/,
      /<meta property="og:title" content="([^"]+)"/,
      /<title>([^<]+)<\/title>/,
    ];

    for (const pattern of titlePatterns) {
      const match = html.match(pattern);
      if (match) {
        title = match[1].replace(" - YouTube", "");
        break;
      }
    }

    // Extract thumbnail (try multiple patterns)
    let thumbnail = null;
    const thumbnailPatterns = [
      /"avatar":\{"thumbnails":\[{"url":"([^"]+)"/,
      /<meta property="og:image" content="([^"]+)"/,
      /"thumbnails":\[\{"url":"([^"]+)","width":\d+,"height":\d+\}\]/,
    ];

    for (const pattern of thumbnailPatterns) {
      const match = html.match(pattern);
      if (match) {
        thumbnail = match[1];
        break;
      }
    }

    // Try to extract subscriber count and view count
    const subscriberMatch = html.match(
      /"subscriberCountText":\{"simpleText":"([^"]+)"|"metadataParts":\[\{"text":\{"content":"([^"]+subscribers)"/
    );

    const subscribers = subscriberMatch?.[1] || subscriberMatch?.[2];

    console.log("📺 Channel info extracted from HTML:", {
      channelId,
      title,
      url,
      thumbnail,
      subscribers,
      views: null,
      latestVideo: null,
      published: null,
    });

    return {
      success: true,
      data: {
        author: title,
        uri: url,
        title,
        thumbnail,
        viewCount: null, // Could parse from viewCountMatch if needed
        lastVideoId: null,
        lastVideoDate: null,
        channelId,
      },
    };
  } catch (error) {
    console.error("Failed to extract channel info from HTML:", error);
    throw error;
  }
}

async function fetchChannelFeed(channelName: string) {
  try {
    // First try XML feed
    const channelNameWithoutAt = channelName.replace("@", "");
    const response = await fetch(
      `https://www.youtube.com/feeds/videos.xml?user=${channelNameWithoutAt}`
    );

    // Return 404 if the channel is not found
    if (response.status === 404) {
      console.log("XML feed not found, trying HTML extraction...");
      try {
        return await extractChannelIdFromHtml(channelNameWithoutAt);
      } catch {
        console.log("HTML extraction failed, falling back to scraping...");
        return await scrapeChannelInfo(channelNameWithoutAt);
      }
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch feed: ${response.status}`);
    }

    const data = await response.text();
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(data);

    // Get the first entry (latest video)
    const latestEntry = result.feed.entry?.[1];

    const author = result.feed.author[0].name[0];
    const uri = result.feed.author[0].uri[0];
    const title = result.feed.title[0];

    // Get thumbnail from media:group/media:thumbnail
    const thumbnail =
      latestEntry?.["media:group"]?.[0]?.["media:thumbnail"]?.[0]?.$?.url ||
      null;

    // Get view count from media:group/media:community/media:statistics
    const viewCount =
      latestEntry?.["media:group"]?.[0]?.["media:community"]?.[0]?.[
        "media:statistics"
      ]?.[0]?.$?.views || "0";

    const lastVideoId = latestEntry?.["yt:videoId"]?.[0];
    const lastVideoDate = latestEntry?.published?.[0];

    // "https://www.youtube.com/channel/UCW5wxEjGHWNyatgZe-PU_tA"
    // This is uri and the id is the last part of the url which is UCW5wxEjGHWNyatgZe-PU_tA
    const channelIdOnly = uri.split("/").pop();
    console.log(" Channel id is fetched from xml feed", channelIdOnly);
    return {
      success: true,
      data: {
        author,
        uri,
        title,
        thumbnail,
        viewCount: parseInt(viewCount, 10),
        lastVideoId,
        lastVideoDate,
        channelId: channelIdOnly,
      },
    };
  } catch (error) {
    console.error("XML feed failed with error:", error);

    // Try HTML extraction before puppeteer
    try {
      console.log("Trying HTML extraction...");
      return await extractChannelIdFromHtml(channelName);
    } catch {
      console.log("HTML extraction failed, falling back to scraping...");
      return await scrapeChannelInfo(channelName);
    }
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const channelName = searchParams.get("channelName");

  if (!channelName) {
    return Response.json({ success: false, error: "Channel name is required" });
  }

  try {
    const result = await fetchChannelFeed(channelName);
    return Response.json(result.data);
  } catch (error) {
    console.error("Error fetching channel info:", error);
    return Response.json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to fetch channel info",
    });
  }
}
