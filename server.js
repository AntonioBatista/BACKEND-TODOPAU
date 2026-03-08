import express from "express";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
  console.error("Faltan variables de entorno.");
  process.exit(1);
}

async function fetchGithubJson(path) {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "quipreg-backend"
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${res.status}: ${text}`);
  }

  const data = await res.json();
  const content = Buffer.from(data.content, "base64").toString("utf8");
  return JSON.parse(content);
}

app.get("/api/:subject/index", async (req, res) => {
  try {
    const subject = req.params.subject;

    const config = {
      quimica: "QUIM/indexquim.json",
      matii: "MATII/indexmatii.json"
    };

    const path = config[subject];
    if (!path) return res.status(404).json({ error: "Materia no válida" });

    const json = await fetchGithubJson(path);
    res.json(json);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/:subject/file", async (req, res) => {
  try {
    const subject = req.params.subject;
    const file = req.query.name;

    if (!file || typeof file !== "string") {
      return res.status(400).json({ error: "Falta name" });
    }

    const folders = {
      quimica: "QUIM",
      matii: "MATII"
    };

    const folder = folders[subject];
    if (!folder) return res.status(404).json({ error: "Materia no válida" });

    const json = await fetchGithubJson(`${folder}/${file}`);
    res.json(json);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => {
  res.send("Backend QUIPREG operativo");
});

app.listen(PORT, () => {
  console.log(`Servidor en puerto ${PORT}`);
});
