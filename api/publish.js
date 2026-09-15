const OWNER = process.env.GITHUB_OWNER || "maniksinghmehra";
const REPO = process.env.GITHUB_REPO || "playlists";
const BRANCH = process.env.GITHUB_BRANCH || "main";
const API = "https://api.github.com";

const slugify = value => value
  .normalize("NFKD")
  .replace(/[^\w\s-]/g, "")
  .trim()
  .replace(/[\s_-]+/g, "-")
  .toLowerCase() || "playlist";

const github = async (path, options = {}) => {
  const response = await fetch(`${API}/repos/${OWNER}/${REPO}/contents/${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `GitHub request failed (${response.status})`);
  return body;
};

const commitFile = async (path, content, message, sha) => github(path, {
  method: "PUT",
  body: JSON.stringify({ message, content, branch: BRANCH, ...(sha ? { sha } : {}) })
});

const getFile = async path => {
  try {
    const file = await github(path);
    return {
      text: Buffer.from(file.content, "base64").toString("utf8"),
      sha: file.sha
    };
  } catch (error) {
    if (error.message.includes("Not Found")) return { text: "", sha: undefined };
    throw error;
  }
};

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST required." });
    return;
  }
  try {
    const { playlist, image, imageType, adminPassword } = req.body;
    if (!process.env.ADMIN_PASSWORD || adminPassword !== process.env.ADMIN_PASSWORD) {
      res.status(401).json({ error: "Invalid admin password." });
      return;
    }
    if (req.body.action === "verify") {
      res.status(200).json({ ok: true });
      return;
    }
    if (!process.env.GITHUB_TOKEN) {
      res.status(500).json({ error: "GITHUB_TOKEN is not configured in Vercel." });
      return;
    }
    if (!playlist || !playlist.title || !image) throw new Error("Playlist title and cover image are required.");
    const extension = imageType === "image/png" ? ".png" : imageType === "image/webp" ? ".webp" : ".jpg";
    const cover = `${slugify(playlist.title)}${extension}`;
    const indexFile = await getFile("index.html");
    const object = `  {\n    title: ${JSON.stringify(playlist.title)},\n    creator: ${JSON.stringify(playlist.creator)},\n    cover: ${JSON.stringify(cover)},\n    spotify: ${JSON.stringify(playlist.spotify || "")},\n    apple: ${JSON.stringify(playlist.apple || "")},\n    youtube: ${JSON.stringify(playlist.youtube || "")},\n    description: ${JSON.stringify(playlist.description || "")},\n    fullDescription: ${JSON.stringify(playlist.fullDescription || "")}\n  },`;
    const placeholder = /  \{\s*title:\s*"Playlist Name \d+"[\s\S]*?\n  \},?/;
    const matches = [...indexFile.text.matchAll(placeholder)];
    let updatedIndex = indexFile.text;
    if (matches.length > 0) {
      const match = matches[matches.length - 1];
      updatedIndex = `${indexFile.text.slice(0, match.index)}${object}${indexFile.text.slice(match.index + match[0].length)}`;
    } else {
      updatedIndex = indexFile.text.replace(/\n\];\s*\n\nconst defaultYoutubePlaylistUrl/, `\n${object}\n];\n\nconst defaultYoutubePlaylistUrl`);
    }
    if (updatedIndex === indexFile.text) throw new Error("Could not find the playlist array in index.html.");

    const existingCover = await getFile(cover);
    await commitFile(cover, image, `Add cover for ${playlist.title}`, existingCover.sha);
    await commitFile("index.html", Buffer.from(updatedIndex).toString("base64"), `Add playlist ${playlist.title}`, indexFile.sha);
    res.status(200).json({ ...playlist, cover });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
