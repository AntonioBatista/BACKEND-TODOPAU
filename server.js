import express from "express";
import cors from "cors";
import admin from "firebase-admin"; // Necesario para verificar tokens

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
// Debes pegar el JSON de tu cuenta de servicio en una variable de entorno llamada FIREBASE_SERVICE_ACCOUNT
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

// Middleware para identificar el plan del usuario
async function checkUserPlan(req, res, next) {
  const authHeader = req.headers.authorization;
  req.userPlan = 'basico'; // Plan por defecto si no hay login

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const idToken = authHeader.split('Bearer ')[1];
    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      // Aquí buscamos el plan en los Custom Claims o en una DB
      // Por ahora, asumimos que si está logueado es al menos 'estudiante'
      req.userPlan = decodedToken.plan || 'estudiante'; 
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

// 1. Obtener Índice (Filtrado por materias según plan)
app.get("/api/:subject/index", checkUserPlan, async (req, res) => {
  try {
    const { subject } = req.params;
    const plan = req.userPlan;

    // Restricción: Básico solo accede a Química
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

// 2. Obtener Preguntas (Filtrado por años y ocultación de soluciones)
app.get("/api/:subject/file", checkUserPlan, async (req, res) => {
  try {
    const { subject } = req.params;
    const file = req.query.name;
    const plan = req.userPlan;

    const folders = { quimica: "QUIM", matii: "MATII", fisica: "FIS", macsii: "MACSII", tinii: "TINII", dtecii: "DTECII" };
    let questions = await fetchGithubJson(`${folders[subject]}/${file}`);

    // LÓGICA DE NIVELES
    
    // Nivel Básico y Estudiante: Solo ven últimos 3 años (2023-2025)
    if (plan === 'basico' || plan === 'estudiante') {
      questions = questions.filter(q => q.exam_year >= 2023);
    }

    // Nivel Básico y Estudiante: NO ven soluciones (borramos el campo)
    if (plan === 'basico' || plan === 'estudiante') {
      questions = questions.map(q => {
        const { solution, ...rest } = q;
        return rest;
      });
    }

    res.json(questions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Servidor operativo en puerto ${PORT}`));

// Ruta para que el administrador cambie planes
app.post("/api/admin/set-plan", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send("No autorizado");

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    
    // SEGURIDAD: Solo tu email puede usar esta ruta
    if (decodedToken.email !== 'TU_EMAIL_DE_ADMIN@gmail.com') {
      return res.status(403).send("No tienes permisos de administrador");
    }

    const { email, plan } = req.body;
    const user = await admin.auth().getUserByEmail(email);
    
    // Asignamos el plan como un Custom Claim
    await admin.auth().setCustomUserClaims(user.uid, { plan: plan });
    
    res.json({ message: `Plan ${plan} asignado a ${email}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
