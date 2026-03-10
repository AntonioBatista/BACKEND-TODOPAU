import express from "express";
import cors from "cors";
import admin from "firebase-admin";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// --- CONFIGURACIÓN GITHUB ---
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

// --- CONFIGURACIÓN FIREBASE ADMIN ---
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

// Middleware corregido para identificar plan y email
async function checkUserPlan(req, res, next) {
  const authHeader = req.headers.authorization;
  req.userPlan = 'basico';
  req.userEmail = null; // Inicializamos el email

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const idToken = authHeader.split('Bearer ')[1];
    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      req.userPlan = decodedToken.plan || 'estudiante';
      req.userEmail = decodedToken.email; // Guardamos el email para validaciones
    } catch (error) {
      console.error("Error verificando token:", error);
    }
  }
  next();
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

  if (!res.ok) throw new Error(`GitHub Error: ${res.status}`);
  const data = await res.json();
  return JSON.parse(Buffer.from(data.content, "base64").toString("utf8"));
}

// 1. Obtener Índice
app.get("/api/:subject/index", checkUserPlan, async (req, res) => {
  try {
    const { subject } = req.params;
    const plan = req.userPlan;

    if (plan === 'basico' && subject !== 'quimica') {
      return res.status(403).json({ error: "Plan Estudiante requerido para esta materia" });
    }

    const config = {
      quimica: "QUIM/indexquim.json",
      matii: "MATII/indexmatii.json",
      fisica: "FIS/indexfis.json",
      macsii: "MACSII/indexmacsii.json",
      tinii: "TINII/indextinii.json",
      dtecii: "DTECII/indexdtecii.json"
    };

    const json = await fetchGithubJson(config[subject]);
    res.json(json);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Obtener Preguntas (Lógica de soluciones corregida)
app.get("/api/:subject/file", checkUserPlan, async (req, res) => {
  try {
    const { subject } = req.params;
    const file = req.query.name;
    const plan = req.userPlan;
    const email = req.userEmail;

    const folders = { quimica: "QUIM", matii: "MATII", fisica: "FIS", macsii: "MACSII", tinii: "TINII", dtecii: "DTECII" };
    let questions = await fetchGithubJson(`${folders[subject]}/${file}`);

    // --- FILTRADO POR AÑOS ---
    if (plan === 'basico' || plan === 'estudiante') {
      questions = questions.filter(q => q.exam_year >= 2023);
    }

    // --- LÓGICA DE SOLUCIONES (EL FILTRO CORRECTO) ---
    // Solo permitimos ver soluciones si:
    // Es el admin (tú) O tiene plan 'pro' O tiene plan 'docente'
    const tienePermiso = (email === 'profeabatista@gmail.com' || plan === 'pro' || plan === 'docente');

    if (!tienePermiso) {
      questions = questions.map(q => {
        const { solution, ...rest } = q; // Borramos el campo solution
        return rest;
      });
    }

    res.json(questions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => {
  res.send("Servidor de TodoPAU operativo y listo.");
});

// Ruta Admin corregida
app.post("/api/admin/set-plan", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send("No autorizado");

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    
    if (decodedToken.email !== 'profeabatista@gmail.com') {
      return res.status(403).send("No tienes permisos de administrador");
    }

    const { email, plan } = req.body;
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().setCustomUserClaims(user.uid, { plan: plan });
    
    res.json({ message: `Plan ${plan} asignado a ${email}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => console.log(`Servidor operativo en puerto ${PORT}`));
