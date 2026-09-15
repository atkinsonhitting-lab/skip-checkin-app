// Coach feed auto-pull (Sep 15 2026): watches the YouTube channels of the
// coaches in the Learn feed and adds new uploads as feed cards.
// Instagram/X have no free public feed for other people's posts, so those
// come in through the coach's "Post to the feed" box (link field).
const FEED_SOURCES = [
  { coach: 'Trey Hannam', channelId: 'UCTabsba8SyHE0O-k0e5zmrg' },
  { coach: 'Anderson Miller', channelId: 'UCx5Ngyt6oAmrlQ3NM1GNMIQ' },
];
const MAX_AGE_DAYS = 45; // backfill window on first run
const MAX_PER_RUN = 5; // per channel per poll
const POLL_MS = 6 * 60 * 60 * 1000;

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// Minimal parser for YouTube's channel RSS format (stable schema).
function parseRss(xml) {
  const entries = [];
  const blocks = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  for (const b of blocks) {
    const id = (b.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    const title = (b.match(/<title>([^<]*)<\/title>/) || [])[1];
    const link = (b.match(/<link rel="alternate" href="([^"]+)"/) || [])[1];
    const published = (b.match(/<published>([^<]+)<\/published>/) || [])[1];
    const desc = (b.match(/<media:description>([\s\S]*?)<\/media:description>/) || [])[1] || '';
    if (id && title && link && published) {
      entries.push({
        id,
        title: decodeEntities(title),
        link,
        published,
        desc: decodeEntities(desc).trim().replace(/\s+/g, ' '),
      });
    }
  }
  return entries;
}

function snippet(desc, coach) {
  if (!desc) return `New video from ${coach}.`;
  if (desc.length <= 220) return desc;
  return desc.slice(0, 220).replace(/\s+\S*$/, '') + '…';
}

async function pollCoachVideos(db) {
  let added = 0;
  for (const src of FEED_SOURCES) {
    try {
      const res = await fetch(
        `https://www.youtube.com/feeds/videos.xml?channel_id=${src.channelId}`,
        { headers: { 'User-Agent': 'TheDailyHitter/1.0 feed poll' } }
      );
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const entries = parseRss(await res.text()).slice(0, MAX_PER_RUN);
      const exists = db.prepare('SELECT id FROM coach_posts WHERE source_url = ?');
      const insert = db.prepare(
        "INSERT INTO coach_posts (coach_name, title, body, source_url, created_at) VALUES (?, ?, ?, ?, datetime('now'))"
      );
      for (const e of entries) {
        if (Date.now() - new Date(e.published).getTime() > MAX_AGE_DAYS * 86400000) continue;
        if (exists.get(e.link)) continue;
        insert.run(src.coach, e.title.slice(0, 120), snippet(e.desc, src.coach).slice(0, 1000), e.link);
        added++;
      }
    } catch (err) {
      console.warn(`FEED POLL: ${src.coach}: ${err.message}`);
    }
  }
  if (added) console.log(`FEED POLL: added ${added} new video post(s)`);
}

module.exports = { pollCoachVideos, POLL_MS, parseRss };
