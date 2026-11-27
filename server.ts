import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import type {
  AdminCeremonyState,
  Category,
  Nominee,
  PublicCeremonyState,
  StageMode,
  VoteTimelinePoint,
  VoterSummary,
  VoterVoteMap,
} from './src/types';

interface StoredVote {
  id: string;
  categoryId: string;
  nomineeId: string;
  voterId: string;
  voterName: string;
  createdAt: number;
}

interface StoredVoter {
  voterId: string;
  voterName: string;
  joinedAt: number;
}

interface CeremonyStore {
  ceremonyTitle: string;
  ceremonySubtitle: string;
  stageMode: StageMode;
  activeCategoryId: string | null;
  showLiveTalliesOnScreen: boolean;
  categories: Category[];
  votes: StoredVote[];
  voters: Record<string, StoredVoter>;
  adminPasscodeHash: string | null;
  signingSecret: string;
}

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.resolve(DATA_DIR, 'ceremony-store.json');
const DIST_DIR = path.resolve(process.cwd(), 'dist');

const VALID_STAGE_MODES: StageMode[] = ['lobby', 'category', 'closed', 'winner', 'summary'];
const ACCENT_PALETTE = ['#D97706', '#0F766E', '#B45309', '#1D4ED8', '#BE123C', '#4338CA'];

function createDefaultCategories(): Category[] {
  return [
    {
      id: 'cat-chef',
      title: 'Mejor Chef de la Familia',
      description: 'Quien siempre sorprende en la mesa y nos reúne alrededor de sus platillos.',
      order: 0,
      isVotingOpen: true,
      isWinnerRevealed: false,
      nominees: [
        { id: 'nom-chef-1', name: 'Abuela Rosa', subtitle: 'Por sus recetas tradicionales de domingo', accentColor: '#D97706' },
        { id: 'nom-chef-2', name: 'Tío Carlos', subtitle: 'Maestro indiscutible del asador', accentColor: '#0F766E' },
        { id: 'nom-chef-3', name: 'Prima Valeria', subtitle: 'Repostería creativa y postres memorables', accentColor: '#BE123C' },
        { id: 'nom-chef-4', name: 'Papá Jorge', subtitle: 'Desayunos de fin de semana sin falta', accentColor: '#1D4ED8' },
      ],
    },
    {
      id: 'cat-alma',
      title: 'Alma de la Fiesta',
      description: 'La persona que enciende la música, anima la pista y contagia alegría en cada reunión.',
      order: 1,
      isVotingOpen: false,
      isWinnerRevealed: false,
      nominees: [
        { id: 'nom-alma-1', name: 'Primo Mateo', subtitle: 'DJ oficial y rey de las dinámicas', accentColor: '#4338CA' },
        { id: 'nom-alma-2', name: 'Tía Sofía', subtitle: 'La primera en abrir la pista de baile', accentColor: '#BE123C' },
        { id: 'nom-alma-3', name: 'Hermano Lucas', subtitle: 'Siempre llega con juegos y ocurrencias', accentColor: '#0F766E' },
      ],
    },
    {
      id: 'cat-anecdota',
      title: 'Mejor Anécdota del Año',
      description: 'Ese momento inolvidable que terminamos contando una y otra vez entre risas.',
      order: 2,
      isVotingOpen: false,
      isWinnerRevealed: false,
      nominees: [
        { id: 'nom-anec-1', name: 'El viaje en carretera', subtitle: 'Cuando tomamos la ruta equivocada y descubrimos el mirador', accentColor: '#D97706' },
        { id: 'nom-anec-2', name: 'La cena de Navidad', subtitle: 'El intercambio secreto de regalos repetidos', accentColor: '#1D4ED8' },
        { id: 'nom-anec-3', name: 'El apagón del domingo', subtitle: 'Lotería a la luz de las velas hasta medianoche', accentColor: '#0F766E' },
      ],
    },
    {
      id: 'cat-consejo',
      title: 'Premio al Mejor Consejo',
      description: 'Para quien siempre tiene una palabra sabia, escucha con paciencia y acompaña en todo momento.',
      order: 3,
      isVotingOpen: false,
      isWinnerRevealed: false,
      nominees: [
        { id: 'nom-cons-1', name: 'Mamá Elena', subtitle: 'Guía incondicional en cada decisión', accentColor: '#BE123C' },
        { id: 'nom-cons-2', name: 'Abuelo Antonio', subtitle: 'Historias que siempre dejan enseñanza', accentColor: '#B45309' },
        { id: 'nom-cons-3', name: 'Tía Lucía', subtitle: 'Calma y claridad cuando más se necesita', accentColor: '#4338CA' },
      ],
    },
  ];
}

function createInitialStore(): CeremonyStore {
  return {
    ceremonyTitle: 'Chavez Awards 2026',
    ceremonySubtitle: 'Gala anual de reconocimientos en vivo',
    stageMode: 'lobby',
    activeCategoryId: 'cat-chef',
    showLiveTalliesOnScreen: true,
    categories: createDefaultCategories(),
    votes: [],
    voters: {},
    adminPasscodeHash: null,
    signingSecret: crypto.randomBytes(32).toString('hex'),
  };
}

function loadStore(): CeremonyStore {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<CeremonyStore>;
      const fallback = createInitialStore();
      return {
        ceremonyTitle: typeof parsed.ceremonyTitle === 'string' && parsed.ceremonyTitle.trim() ? parsed.ceremonyTitle : fallback.ceremonyTitle,
        ceremonySubtitle: typeof parsed.ceremonySubtitle === 'string' ? parsed.ceremonySubtitle : fallback.ceremonySubtitle,
        stageMode: VALID_STAGE_MODES.includes(parsed.stageMode as StageMode) ? (parsed.stageMode as StageMode) : 'lobby',
        activeCategoryId: typeof parsed.activeCategoryId === 'string' ? parsed.activeCategoryId : fallback.activeCategoryId,
        showLiveTalliesOnScreen: typeof parsed.showLiveTalliesOnScreen === 'boolean' ? parsed.showLiveTalliesOnScreen : true,
        categories: Array.isArray(parsed.categories) && parsed.categories.length > 0 ? parsed.categories : fallback.categories,
        votes: Array.isArray(parsed.votes) ? parsed.votes : [],
        voters: parsed.voters && typeof parsed.voters === 'object' ? parsed.voters : {},
        adminPasscodeHash: typeof parsed.adminPasscodeHash === 'string' ? parsed.adminPasscodeHash : null,
        signingSecret: typeof parsed.signingSecret === 'string' && parsed.signingSecret.length >= 32 ? parsed.signingSecret : fallback.signingSecret,
      };
    }
  } catch (err) {
    console.error('Error loading store, using default:', err);
  }
  const initial = createInitialStore();
  saveStore(initial);
  return initial;
}

function saveStore(data: CeremonyStore): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tempPath = `${STORE_PATH}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, STORE_PATH);
  } catch (err) {
    console.error('Error saving store:', err);
  }
}

const store = loadStore();

// Active admin sessions in memory (token -> expiry timestamp)
const adminSessions = new Map<string, number>();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function getSigningSecret(): string {
  return process.env.SESSION_SECRET?.trim() || store.signingSecret;
}

function hashPasscode(passcode: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(passcode, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPasscodeHash(passcode: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(passcode, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

function verifyEnvPasscode(passcode: string, envPasscode: string): boolean {
  const a = crypto.createHash('sha256').update(passcode).digest();
  const b = crypto.createHash('sha256').update(envPasscode).digest();
  return crypto.timingSafeEqual(a, b);
}

function verifyAdminPasscode(passcode: string): boolean {
  const envPass = process.env.ADMIN_PASSCODE?.trim();
  if (envPass) {
    return verifyEnvPasscode(passcode, envPass);
  }
  if (store.adminPasscodeHash) {
    return verifyPasscodeHash(passcode, store.adminPasscodeHash);
  }
  return false;
}

function isAdminSetupRequired(): boolean {
  const envPass = process.env.ADMIN_PASSCODE?.trim();
  if (envPass) return false;
  return !store.adminPasscodeHash;
}

function createAdminSession(): string {
  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function isValidAdminToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const expiresAt = adminSessions.get(token);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim() || null;
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (!isValidAdminToken(token)) {
    res.status(401).json({ error: 'Sesión de administrador requerida o expirada.' });
    return;
  }
  next();
}

// Voter token signing (HMAC-SHA256 of voterId)
function signVoterId(voterId: string): string {
  const sig = crypto.createHmac('sha256', getSigningSecret()).update(voterId).digest('hex');
  return `${voterId}.${sig}`;
}

function verifyVoterToken(token: string | undefined | null): string | null {
  if (!token || typeof token !== 'string') return null;
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx <= 0) return null;
  const voterId = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!voterId || !sig) return null;
  const expected = crypto.createHmac('sha256', getSigningSecret()).update(voterId).digest('hex');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  return voterId;
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) {
      const k = part.slice(0, idx).trim();
      const v = decodeURIComponent(part.slice(idx + 1).trim());
      result[k] = v;
    }
  }
  return result;
}

function resolveVoterIdFromRequest(req: Request): string | null {
  const headerToken = req.headers['x-voter-token'];
  if (typeof headerToken === 'string') {
    const verified = verifyVoterToken(headerToken);
    if (verified) return verified;
  }
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.gala_voter) {
    const verified = verifyVoterToken(cookies.gala_voter);
    if (verified) return verified;
  }
  return null;
}

function setVoterCookie(req: Request, res: Response, voterToken: string): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const attrs = [
    `gala_voter=${encodeURIComponent(voterToken)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${60 * 60 * 24 * 7}`,
  ];
  if (isHttps) {
    attrs.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', attrs.join('; '));
}

// WebSocket tracking
interface WsClientMeta {
  ws: WebSocket;
  role: 'voter' | 'screen' | 'admin' | 'unknown';
  isAdminAuthed: boolean;
}

const wsClients = new Set<WsClientMeta>();

function getConnectedCounts(): { voters: number; screens: number } {
  let voters = 0;
  let screens = 0;
  for (const client of wsClients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      if (client.role === 'voter') voters += 1;
      if (client.role === 'screen') screens += 1;
    }
  }
  return { voters, screens };
}

function computeCategoryCounts(category: Category): { totalVotes: number; countsByNominee: Record<string, number> } {
  const countsByNominee: Record<string, number> = {};
  for (const nom of category.nominees) {
    countsByNominee[nom.id] = 0;
  }
  let totalVotes = 0;
  for (const vote of store.votes) {
    if (vote.categoryId === category.id && vote.nomineeId in countsByNominee) {
      countsByNominee[vote.nomineeId] += 1;
      totalVotes += 1;
    }
  }
  return { totalVotes, countsByNominee };
}

function buildPublicState(audience: 'screen' | 'voter'): PublicCeremonyState {
  const { voters } = getConnectedCounts();
  const sortedCategories = [...store.categories].sort((a, b) => a.order - b.order);

  const categories = sortedCategories.map((cat) => {
    const { totalVotes, countsByNominee } = computeCategoryCounts(cat);
    const shouldRevealTallies =
      cat.isWinnerRevealed ||
      (audience === 'screen' &&
        (store.showLiveTalliesOnScreen ||
          (store.stageMode === 'winner' && store.activeCategoryId === cat.id) ||
          store.stageMode === 'summary'));

    return {
      id: cat.id,
      title: cat.title,
      description: cat.description,
      order: cat.order,
      isVotingOpen: cat.isVotingOpen,
      isWinnerRevealed: cat.isWinnerRevealed,
      totalVotes,
      nominees: cat.nominees.map((nom) => {
        const count = countsByNominee[nom.id] ?? 0;
        const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 1000) / 10 : 0;
        return {
          ...nom,
          votes: shouldRevealTallies ? count : null,
          percentage: shouldRevealTallies ? pct : null,
        };
      }),
    };
  });

  return {
    ceremonyTitle: store.ceremonyTitle,
    ceremonySubtitle: store.ceremonySubtitle,
    stageMode: store.stageMode,
    activeCategoryId: store.activeCategoryId,
    showLiveTalliesOnScreen: store.showLiveTalliesOnScreen,
    connectedVotersCount: voters,
    registeredVotersCount: Object.keys(store.voters).length,
    totalVotesCast: store.votes.length,
    categories,
    updatedAt: Date.now(),
  };
}

function buildAdminState(): AdminCeremonyState {
  const { voters, screens } = getConnectedCounts();
  const sortedCategories = [...store.categories].sort((a, b) => a.order - b.order);

  const categories = sortedCategories.map((cat) => {
    const { totalVotes, countsByNominee } = computeCategoryCounts(cat);
    return {
      ...cat,
      totalVotes,
      nominees: cat.nominees.map((nom) => {
        const count = countsByNominee[nom.id] ?? 0;
        const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 1000) / 10 : 0;
        return {
          ...nom,
          votes: count,
          percentage: pct,
        };
      }),
    };
  });

  const voterVotesCount: Record<string, { count: number; lastVotedAt: number | null }> = {};
  for (const v of store.votes) {
    if (!voterVotesCount[v.voterId]) {
      voterVotesCount[v.voterId] = { count: 0, lastVotedAt: null };
    }
    voterVotesCount[v.voterId].count += 1;
    if (!voterVotesCount[v.voterId].lastVotedAt || v.createdAt > voterVotesCount[v.voterId].lastVotedAt!) {
      voterVotesCount[v.voterId].lastVotedAt = v.createdAt;
    }
  }

  const votersList: VoterSummary[] = Object.values(store.voters)
    .map((v) => ({
      voterId: v.voterId,
      voterName: v.voterName,
      votesCount: voterVotesCount[v.voterId]?.count ?? 0,
      joinedAt: v.joinedAt,
      lastVotedAt: voterVotesCount[v.voterId]?.lastVotedAt ?? null,
    }))
    .sort((a, b) => b.joinedAt - a.joinedAt);

  // Build vote timeline grouped by minute
  const timelineBuckets = new Map<number, number>();
  for (const v of store.votes) {
    const minuteTs = Math.floor(v.createdAt / 60000) * 60000;
    timelineBuckets.set(minuteTs, (timelineBuckets.get(minuteTs) ?? 0) + 1);
  }
  const timeline: VoteTimelinePoint[] = Array.from(timelineBuckets.entries())
    .sort((a, b) => a[0] - b[0])
    .slice(-20)
    .map(([ts, count]) => {
      const d = new Date(ts);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return { minuteLabel: `${hh}:${mm}`, timestamp: ts, count };
    });

  return {
    ceremonyTitle: store.ceremonyTitle,
    ceremonySubtitle: store.ceremonySubtitle,
    stageMode: store.stageMode,
    activeCategoryId: store.activeCategoryId,
    showLiveTalliesOnScreen: store.showLiveTalliesOnScreen,
    connectedVotersCount: voters,
    connectedScreensCount: screens,
    registeredVotersCount: Object.keys(store.voters).length,
    totalVotesCast: store.votes.length,
    categories,
    voters: votersList,
    timeline,
    updatedAt: Date.now(),
  };
}

function getVoterVoteMap(voterId: string): VoterVoteMap {
  const map: VoterVoteMap = {};
  for (const v of store.votes) {
    if (v.voterId === voterId) {
      map[v.categoryId] = v.nomineeId;
    }
  }
  return map;
}

function broadcastState(): void {
  const screenPayload = JSON.stringify({ type: 'state:public', state: buildPublicState('screen') });
  const voterPayload = JSON.stringify({ type: 'state:public', state: buildPublicState('voter') });
  const adminPayload = JSON.stringify({ type: 'state:admin', state: buildAdminState() });

  for (const client of wsClients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    if (client.role === 'admin' && client.isAdminAuthed) {
      client.ws.send(adminPayload);
    } else if (client.role === 'screen') {
      client.ws.send(screenPayload);
    } else if (client.role === 'voter') {
      client.ws.send(voterPayload);
    }
  }
}

async function startServer(): Promise<void> {
  const app = express();
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      let allowed = false;
      try {
        const parsed = new URL(origin);
        const configured = (process.env.ALLOWED_ORIGIN || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (
          configured.includes(origin) ||
          (parsed.protocol === 'https:' && parsed.hostname.endsWith('.github.io')) ||
          parsed.hostname === 'localhost' ||
          parsed.hostname === '127.0.0.1'
        ) {
          allowed = true;
        }
      } catch {
        allowed = false;
      }
      if (allowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-voter-token');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const meta: WsClientMeta = { ws, role: 'unknown', isAdminAuthed: false };
    wsClients.add(meta);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          role?: string;
          adminToken?: string;
        };
        if (msg.type === 'hello') {
          if (msg.role === 'admin') {
            if (isValidAdminToken(msg.adminToken)) {
              meta.role = 'admin';
              meta.isAdminAuthed = true;
              ws.send(JSON.stringify({ type: 'state:admin', state: buildAdminState() }));
            } else {
              ws.send(JSON.stringify({ type: 'auth:error', message: 'Token de administrador inválido' }));
            }
          } else if (msg.role === 'screen') {
            meta.role = 'screen';
            ws.send(JSON.stringify({ type: 'state:public', state: buildPublicState('screen') }));
            broadcastState();
          } else if (msg.role === 'voter') {
            meta.role = 'voter';
            ws.send(JSON.stringify({ type: 'state:public', state: buildPublicState('voter') }));
            broadcastState();
          }
        }
      } catch {
        // Ignore malformed socket messages
      }
    });

    ws.on('close', () => {
      const wasActive = meta.role === 'voter' || meta.role === 'screen';
      wsClients.delete(meta);
      if (wasActive) {
        broadcastState();
      }
    });
  });

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Public state endpoint (audience-scoped)
  app.get('/api/public/state', (req, res) => {
    const audience = req.query.audience === 'screen' ? 'screen' : 'voter';
    res.json(buildPublicState(audience));
  });

  // Voter session & registration
  app.get('/api/voter/session', (req, res) => {
    const existingVoterId = resolveVoterIdFromRequest(req);
    if (!existingVoterId || !store.voters[existingVoterId]) {
      res.json({ registered: false });
      return;
    }
    const voter = store.voters[existingVoterId];
    const token = signVoterId(voter.voterId);
    res.json({
      registered: true,
      voterId: voter.voterId,
      voterName: voter.voterName,
      voterToken: token,
      myVotes: getVoterVoteMap(voter.voterId),
    });
  });

  app.post('/api/voter/register', (req, res) => {
    const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const cleanName = rawName.slice(0, 50);
    if (!cleanName || cleanName.length < 2) {
      res.status(400).json({ error: 'Por favor escribe tu nombre (mínimo 2 caracteres).' });
      return;
    }

    let voterId = resolveVoterIdFromRequest(req);
    if (!voterId) {
      voterId = `voter-${crypto.randomUUID()}`;
    }

    if (!store.voters[voterId]) {
      store.voters[voterId] = {
        voterId,
        voterName: cleanName,
        joinedAt: Date.now(),
      };
    } else {
      store.voters[voterId].voterName = cleanName;
      // Keep stored vote voterName synced
      for (const v of store.votes) {
        if (v.voterId === voterId) {
          v.voterName = cleanName;
        }
      }
    }

    saveStore(store);
    const voterToken = signVoterId(voterId);
    setVoterCookie(req, res, voterToken);
    broadcastState();

    res.json({
      voterId,
      voterName: cleanName,
      voterToken,
      myVotes: getVoterVoteMap(voterId),
    });
  });

  // Cast a single vote per category
  app.post('/api/vote', (req, res) => {
    const voterId = resolveVoterIdFromRequest(req);
    if (!voterId || !store.voters[voterId]) {
      res.status(401).json({ error: 'Registra tu nombre antes de votar.' });
      return;
    }

    const categoryId = typeof req.body?.categoryId === 'string' ? req.body.categoryId.trim() : '';
    const nomineeId = typeof req.body?.nomineeId === 'string' ? req.body.nomineeId.trim() : '';

    const category = store.categories.find((c) => c.id === categoryId);
    if (!category) {
      res.status(404).json({ error: 'Categoría no encontrada.' });
      return;
    }

    if (!category.isVotingOpen) {
      res.status(403).json({ error: 'La votación para esta categoría está cerrada.' });
      return;
    }

    const nominee = category.nominees.find((n) => n.id === nomineeId);
    if (!nominee) {
      res.status(404).json({ error: 'Nominado no válido en esta categoría.' });
      return;
    }

    // Strict server-side single-vote enforcement per category
    const alreadyVoted = store.votes.some((v) => v.categoryId === categoryId && v.voterId === voterId);
    if (alreadyVoted) {
      res.status(409).json({ error: 'Ya emitiste tu voto en esta categoría. Solo se permite 1 voto por categoría.' });
      return;
    }

    store.votes.push({
      id: `vote-${crypto.randomUUID()}`,
      categoryId,
      nomineeId,
      voterId,
      voterName: store.voters[voterId].voterName,
      createdAt: Date.now(),
    });

    saveStore(store);
    broadcastState();

    res.status(201).json({
      ok: true,
      categoryId,
      nomineeId,
      myVotes: getVoterVoteMap(voterId),
    });
  });

  // Admin authentication routes
  app.get('/api/admin/status', (req, res) => {
    const token = extractBearerToken(req);
    res.json({
      setupRequired: isAdminSetupRequired(),
      authenticated: isValidAdminToken(token),
    });
  });

  app.post('/api/admin/claim', (req, res) => {
    if (!isAdminSetupRequired()) {
      res.status(409).json({ error: 'La clave de organizador ya ha sido configurada.' });
      return;
    }
    const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';
    if (passcode.length < 4 || passcode.length > 64) {
      res.status(400).json({ error: 'La clave debe tener entre 4 y 64 caracteres.' });
      return;
    }
    store.adminPasscodeHash = hashPasscode(passcode);
    saveStore(store);
    const token = createAdminSession();
    res.status(201).json({ token, authenticated: true });
  });

  app.post('/api/admin/login', (req, res) => {
    if (isAdminSetupRequired()) {
      res.status(400).json({ error: 'Primero debes configurar una clave de organizador.' });
      return;
    }
    const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';
    if (!passcode || !verifyAdminPasscode(passcode)) {
      res.status(401).json({ error: 'Clave incorrecta.' });
      return;
    }
    const token = createAdminSession();
    res.json({ token, authenticated: true });
  });

  app.post('/api/admin/logout', (req, res) => {
    const token = extractBearerToken(req);
    if (token) adminSessions.delete(token);
    res.json({ ok: true });
  });

  // Admin state & conductor routes
  app.get('/api/admin/state', requireAdmin, (_req, res) => {
    res.json(buildAdminState());
  });

  app.put('/api/admin/ceremony', requireAdmin, (req, res) => {
    const { ceremonyTitle, ceremonySubtitle, stageMode, activeCategoryId, showLiveTalliesOnScreen } = req.body ?? {};

    if (typeof ceremonyTitle === 'string') {
      const clean = ceremonyTitle.trim().slice(0, 80);
      if (!clean) {
        res.status(400).json({ error: 'El título no puede estar vacío.' });
        return;
      }
      store.ceremonyTitle = clean;
    }
    if (typeof ceremonySubtitle === 'string') {
      store.ceremonySubtitle = ceremonySubtitle.trim().slice(0, 140);
    }
    if (stageMode !== undefined) {
      if (!VALID_STAGE_MODES.includes(stageMode)) {
        res.status(400).json({ error: 'Modo de pantalla inválido.' });
        return;
      }
      store.stageMode = stageMode;
      if (stageMode === 'winner' && store.activeCategoryId) {
        const activeCat = store.categories.find((c) => c.id === store.activeCategoryId);
        if (activeCat) {
          activeCat.isWinnerRevealed = true;
          activeCat.isVotingOpen = false;
        }
      }
      if (stageMode === 'closed' && store.activeCategoryId) {
        const activeCat = store.categories.find((c) => c.id === store.activeCategoryId);
        if (activeCat) {
          activeCat.isVotingOpen = false;
        }
      }
    }
    if (activeCategoryId !== undefined) {
      if (activeCategoryId === null) {
        store.activeCategoryId = null;
      } else if (typeof activeCategoryId === 'string' && store.categories.some((c) => c.id === activeCategoryId)) {
        store.activeCategoryId = activeCategoryId;
      } else {
        res.status(400).json({ error: 'Categoría activa inválida.' });
        return;
      }
    }
    if (typeof showLiveTalliesOnScreen === 'boolean') {
      store.showLiveTalliesOnScreen = showLiveTalliesOnScreen;
    }

    saveStore(store);
    broadcastState();
    res.json(buildAdminState());
  });

  // Category CRUD
  app.post('/api/admin/categories', requireAdmin, (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 80) : '';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim().slice(0, 220) : '';
    const rawNominees: unknown[] = Array.isArray(req.body?.nominees) ? req.body.nominees : [];

    if (!title) {
      res.status(400).json({ error: 'El nombre de la categoría es obligatorio.' });
      return;
    }

    const nominees: Nominee[] = rawNominees
      .filter((n): n is { name: string; subtitle?: string; accentColor?: string } => {
        return typeof n === 'object' && n !== null && typeof (n as { name?: unknown }).name === 'string' && (n as { name: string }).name.trim().length > 0;
      })
      .map((n, idx) => ({
        id: `nom-${crypto.randomUUID().slice(0, 8)}`,
        name: n.name.trim().slice(0, 60),
        subtitle: typeof n.subtitle === 'string' ? n.subtitle.trim().slice(0, 120) : '',
        accentColor: typeof n.accentColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(n.accentColor)
          ? n.accentColor
          : ACCENT_PALETTE[idx % ACCENT_PALETTE.length],
      }));

    if (nominees.length < 2) {
      res.status(400).json({ error: 'Agrega al menos 2 nominados por categoría.' });
      return;
    }

    const maxOrder = store.categories.reduce((max, c) => Math.max(max, c.order), -1);
    const newCategory: Category = {
      id: `cat-${crypto.randomUUID().slice(0, 8)}`,
      title,
      description,
      order: maxOrder + 1,
      isVotingOpen: false,
      isWinnerRevealed: false,
      nominees,
    };

    store.categories.push(newCategory);
    if (!store.activeCategoryId) {
      store.activeCategoryId = newCategory.id;
    }

    saveStore(store);
    broadcastState();
    res.status(201).json(buildAdminState());
  });

  app.put('/api/admin/categories/:id', requireAdmin, (req, res) => {
    const category = store.categories.find((c) => c.id === req.params.id);
    if (!category) {
      res.status(404).json({ error: 'Categoría no encontrada.' });
      return;
    }

    const { title, description, isVotingOpen, isWinnerRevealed, nominees } = req.body ?? {};

    if (typeof title === 'string') {
      const clean = title.trim().slice(0, 80);
      if (!clean) {
        res.status(400).json({ error: 'El nombre de la categoría no puede estar vacío.' });
        return;
      }
      category.title = clean;
    }
    if (typeof description === 'string') {
      category.description = description.trim().slice(0, 220);
    }
    if (typeof isVotingOpen === 'boolean') {
      category.isVotingOpen = isVotingOpen;
    }
    if (typeof isWinnerRevealed === 'boolean') {
      category.isWinnerRevealed = isWinnerRevealed;
    }
    if (Array.isArray(nominees)) {
      const updatedNominees: Nominee[] = (nominees as unknown[])
        .filter((n): n is { id?: string; name: string; subtitle?: string; accentColor?: string } => {
          return typeof n === 'object' && n !== null && typeof (n as { name?: unknown }).name === 'string' && (n as { name: string }).name.trim().length > 0;
        })
        .map((n, idx) => ({
          id: typeof n.id === 'string' && n.id.trim() ? n.id.trim() : `nom-${crypto.randomUUID().slice(0, 8)}`,
          name: n.name.trim().slice(0, 60),
          subtitle: typeof n.subtitle === 'string' ? n.subtitle.trim().slice(0, 120) : '',
          accentColor: typeof n.accentColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(n.accentColor)
            ? n.accentColor
            : ACCENT_PALETTE[idx % ACCENT_PALETTE.length],
        }));

      if (updatedNominees.length < 2) {
        res.status(400).json({ error: 'Cada categoría debe tener al menos 2 nominados.' });
        return;
      }
      category.nominees = updatedNominees;
      const validIds = new Set(updatedNominees.map((n) => n.id));
      store.votes = store.votes.filter((v) => v.categoryId !== category.id || validIds.has(v.nomineeId));
    }

    saveStore(store);
    broadcastState();
    res.json(buildAdminState());
  });

  app.post('/api/admin/categories/reorder', requireAdmin, (req, res) => {
    const orderedIds = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds : [];
    const map = new Map<string, number>();
    orderedIds.forEach((id: unknown, idx: number) => {
      if (typeof id === 'string') map.set(id, idx);
    });
    for (const cat of store.categories) {
      if (map.has(cat.id)) {
        cat.order = map.get(cat.id)!;
      }
    }
    store.categories.sort((a, b) => a.order - b.order);
    store.categories.forEach((c, idx) => {
      c.order = idx;
    });

    saveStore(store);
    broadcastState();
    res.json(buildAdminState());
  });

  app.delete('/api/admin/categories/:id', requireAdmin, (req, res) => {
    const idx = store.categories.findIndex((c) => c.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Categoría no encontrada.' });
      return;
    }
    const [removed] = store.categories.splice(idx, 1);
    store.votes = store.votes.filter((v) => v.categoryId !== removed.id);
    store.categories.forEach((c, i) => {
      c.order = i;
    });
    if (store.activeCategoryId === removed.id) {
      store.activeCategoryId = store.categories[0]?.id ?? null;
    }

    saveStore(store);
    broadcastState();
    res.json(buildAdminState());
  });

  // Bulk voting controls & vote reset
  app.post('/api/admin/voting/bulk', requireAdmin, (req, res) => {
    const action = req.body?.action;
    if (action === 'open-all') {
      store.categories.forEach((c) => {
        c.isVotingOpen = true;
      });
    } else if (action === 'close-all') {
      store.categories.forEach((c) => {
        c.isVotingOpen = false;
      });
    } else {
      res.status(400).json({ error: 'Acción inválida.' });
      return;
    }

    saveStore(store);
    broadcastState();
    res.json(buildAdminState());
  });

  app.post('/api/admin/reset-votes', requireAdmin, (req, res) => {
    const categoryId = typeof req.body?.categoryId === 'string' ? req.body.categoryId : null;
    if (categoryId) {
      store.votes = store.votes.filter((v) => v.categoryId !== categoryId);
      const cat = store.categories.find((c) => c.id === categoryId);
      if (cat) cat.isWinnerRevealed = false;
    } else {
      store.votes = [];
      store.categories.forEach((c) => {
        c.isWinnerRevealed = false;
      });
    }

    saveStore(store);
    broadcastState();
    res.json(buildAdminState());
  });

  // Vite dev middleware or production static serving
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(DIST_DIR));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(DIST_DIR, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Gala Familiar server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
