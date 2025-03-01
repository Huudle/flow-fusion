import { ChannelFromXmlFeed } from "./types";

export async function startChannelInfoUpdate(channelId: string, profileId: string) {
  try {
    const response = await fetch(
      `/api/youtube/channel?channelId=${encodeURIComponent(
        channelId
      )}&profileId=${profileId}`
    );
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || "Failed to fetch channel info");
    }

    return data;
  } catch (error) {
    console.error("Error fetching channel info:", error);
    throw error;
  }
}

export async function fetchChannelFeed(
  channelName: string
): Promise<ChannelFromXmlFeed> {
  try {
    const response = await fetch(
      `/api/youtube/channel/resolve-id?channelName=${encodeURIComponent(
        channelName
      )}`
    );
    const data = await response.json();

    if (!data) {
      throw new Error(data.error || "Failed to fetch channel feed");
    }

    return data;
  } catch (error) {
    console.error("Error fetching channel feed:", error);
    throw error;
  }
}
