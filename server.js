const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8000;
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
};

const send = (res, status, body, contentType = "text/plain; charset=utf-8") => {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
};

const readRequestBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on("data", chunk => chunks.push(chunk));
  req.on("end", () => resolve(Buffer.concat(chunks)));
  req.on("error", reject);
});

const parseMultipart = (body, contentType) => {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundary) throw new Error("Multipart boundary is missing.");

  const marker = Buffer.from(`--${boundary[1] || boundary[2]}`);
  const fields = {};
  let position = body.indexOf(marker) + marker.length;

  while (position >= marker.length && position < body.length) {
    if (body.subarray(position, position + 2).equals(Buffer.from("--"))) break;
    if (body.subarray(position, position + 2).equals(Buffer.from("\r\n"))) position += 2;

    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), position);
    if (headerEnd < 0) break;
    const headers = body.subarray(position, headerEnd).toString("utf8");
    const nextBoundary = body.indexOf(marker, headerEnd + 4);
    if (nextBoundary < 0) break;
    const valueEnd = nextBoundary - 2;
    const disposition = headers.match(/name="([^"]+)"/i);
    if (disposition) {
      const name = disposition[1];
      const filename = headers.match(/filename="([^"]*)"/i);
      fields[name] = {
        filename: filename ? filename[1] : "",
        value: body.subarray(headerEnd + 4, valueEnd)
      };
    }
    position = nextBoundary + marker.length;
  }

  return fields;
};

const getSafeCoverName = (title, extension) => {
  const slug = title
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .toLowerCase();

  if (!slug) {
    throw new Error("Title must contain letters or numbers for the cover filename.");
  }

  return `${slug}${extension === ".jpeg" ? ".jpg" : extension}`;
};

const uploadCover = async (req, res) => {
  const body = await readRequestBody(req);
  const fields = parseMultipart(body, req.headers["content-type"] || "");
  const playlist = JSON.parse(fields.playlist.value.toString("utf8"));
  const image = fields.coverFile;

  if (!image || !image.filename || !image.value.length) {
    throw new Error("Choose a cover image.");
  }

  const extension = path.extname(image.filename).toLowerCase();
  if (![".jpg", ".jpeg", ".png", ".webp"].includes(extension)) {
    throw new Error("Cover must be JPG, PNG, or WebP.");
  }

  const cover = getSafeCoverName(playlist.title, extension);
  fs.writeFileSync(path.join(ROOT, cover), image.value);

  const savedPlaylist = {
    ...playlist,
    cover,
    ...(fields.slotIndex ? { slotIndex: Number(fields.slotIndex.value.toString("utf8")) } : {})
  };
  send(res, 200, JSON.stringify(savedPlaylist), "application/json; charset=utf-8");
};

const serveFile = (req, res) => {
  const requestPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  const filePath = path.resolve(ROOT, `.${requestPath === "/" ? "/index.html" : requestPath}`);
  if (!filePath.startsWith(ROOT + path.sep)) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 404, "Not found");
      return;
    }
    send(res, 200, data, MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream");
  });
};

http.createServer(async (req, res) => {
  const requestPath = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
  if (req.method === "POST" && requestPath === "/api/upload-cover") {
    try {
      await uploadCover(req, res);
    } catch (error) {
      send(res, 400, JSON.stringify({ error: error.message }), "application/json; charset=utf-8");
    }
    return;
  }
  serveFile(req, res);
}).listen(PORT, () => {
  console.log(`Playlist website running at http://localhost:${PORT}`);
});
