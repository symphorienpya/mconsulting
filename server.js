require('dotenv').config({ override: true });

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3000;
const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY !== 'your-anon-key');
const supabase = hasSupabase
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;
const adminSupabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY !== 'your-service-role-key'
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;
const adminPassword = process.env.ADMIN_PASSWORD || 'change-me-now';
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

function supabaseError(error) {
  return { message: error?.message || 'Supabase request failed.', code: error?.code || null, details: error?.details || null, hint: error?.hint || null, status: error?.status || null };
}

const localRequests = [
  { id: 'MC-2401', name: 'Amina K.', company: 'Kivu Entreprendre', service: 'Accompagnement entrepreneurial', budget: '5 000 $ - 10 000 $', status: 'En découverte', created_at: new Date(Date.now() - 1000 * 60 * 28).toISOString() },
  { id: 'MC-2400', name: 'Jon Bell', company: 'Bell & Co.', service: 'Audit et conseils fiscaux', budget: 'Plus de 10 000 $', status: 'Proposition envoyée', created_at: new Date(Date.now() - 1000 * 60 * 86).toISOString() },
  { id: 'MC-2399', name: 'Maya Chen', company: 'Immo Horizon', service: 'Gestion immobilière', budget: '2 000 $ - 5 000 $', status: 'Nouvelle demande', created_at: new Date(Date.now() - 1000 * 60 * 140).toISOString() }
];
const localActivities = localRequests.map((request) => ({ id: crypto.randomUUID(), request_id: request.id, type: 'booking_created', description: `Nouvelle demande de ${request.name}`, created_at: request.created_at }));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function createAdminToken() {
  const payload = Buffer.from(JSON.stringify({ role: 'admin', expires: Date.now() + 1000 * 60 * 60 * 8 })).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function isAdmin(req) {
  const token = req.headers.cookie?.split(';').map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith('mconsulting_admin='))?.split('=')[1];
  if (!token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try { const session = JSON.parse(Buffer.from(payload, 'base64url').toString()); return session.role === 'admin' && session.expires > Date.now(); } catch { return false; }
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Authentification administrateur requise.' });
  next();
}

async function recordActivity(activity) {
  const entry = { ...activity, created_at: new Date().toISOString() };
  if (adminSupabase) {
    const { error } = await adminSupabase.from('activities').insert(entry);
    if (error) console.error(`Activity log failed: ${error.message}`);
  } else {
    localActivities.unshift({ id: crypto.randomUUID(), ...entry });
  }
  return entry;
}

app.get('/', async (req, res) => {
  let requests = localRequests;
  if (supabase) {
    const { data } = await supabase.from('requests').select('*').order('created_at', { ascending: false }).limit(6);
    if (data) requests = data;
  }
  res.render('index', { requests, hasSupabase });
});

app.get('/admin', (req, res) => res.render('admin', { isAdmin: isAdmin(req), hasSupabase: Boolean(adminSupabase && hasSupabase) }));

app.post('/admin/login', async (req, res) => {
  if (!req.body.password || req.body.password !== adminPassword) return res.status(401).json({ error: 'Mot de passe incorrect.' });
  res.setHeader('Set-Cookie', `mconsulting_admin=${createAdminToken()}; HttpOnly; SameSite=Lax; Path=/`);
  await recordActivity({ type: 'admin_login', description: 'Connexion administrateur' });
  res.json({ ok: true });
});

app.post('/admin/logout', async (req, res) => {
  res.setHeader('Set-Cookie', 'mconsulting_admin=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/');
  await recordActivity({ type: 'admin_logout', description: 'Déconnexion administrateur' });
  res.json({ ok: true });
});

app.get('/api/admin/requests', requireAdmin, async (req, res) => {
  if (adminSupabase) {
    const { data, error } = await adminSupabase.from('requests').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: supabaseError(error) });
    return res.json({ requests: data, realtime: true });
  }
  res.json({ requests: localRequests, realtime: false });
});

app.get('/api/admin/activities', requireAdmin, async (req, res) => {
  if (adminSupabase) {
    const { data, error } = await adminSupabase.from('activities').select('*').order('created_at', { ascending: false }).limit(50);
    if (error) return res.status(500).json({ error: supabaseError(error) });
    return res.json({ activities: data, realtime: true });
  }
  res.json({ activities: localActivities.slice(0, 50), realtime: false });
});

app.patch('/api/admin/requests/:id', requireAdmin, async (req, res) => {
  const allowedStatuses = ['Nouvelle demande', 'En découverte', 'Proposition envoyée', 'En cours', 'Terminée'];
  if (!allowedStatuses.includes(req.body.status)) return res.status(400).json({ error: 'Statut invalide.' });
  if (adminSupabase) {
    const { data, error } = await adminSupabase.from('requests').update({ status: req.body.status }).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: supabaseError(error) });
    await recordActivity({ request_id: data.id, type: 'status_updated', description: `Statut mis à jour : ${data.status}` });
    return res.json({ request: data });
  }
  const request = localRequests.find((item) => item.id === req.params.id);
  if (!request) return res.status(404).json({ error: 'Demande introuvable.' });
  request.status = req.body.status;
  await recordActivity({ request_id: request.id, type: 'status_updated', description: `Statut mis à jour : ${request.status}` });
  res.json({ request });
});

app.post('/api/requests', async (req, res) => {
  const { name, email, company, service, budget, message } = req.body;
  if (!name || !email || !service) return res.status(400).json({ error: 'Name, email, and service are required.' });

  const request = {
    name, email, company: company || 'Independent', service, budget: budget || 'To discuss',
    message: message || '', status: 'Nouvelle demande', created_at: new Date().toISOString()
  };

  const requestWriter = adminSupabase || supabase;
  if (requestWriter) {
    const { data, error } = await requestWriter.from('requests').insert(request).select().single();
    if (error) {
      console.error('Request insert failed:', supabaseError(error));
      return res.status(500).json({ error: supabaseError(error) });
    }
    await recordActivity({ request_id: data.id, type: 'booking_created', description: `Nouvelle demande de ${data.name}` });
    return res.status(201).json({ request: data, realtime: Boolean(adminSupabase) });
  }

  const localRequest = { id: `MC-${String(Date.now()).slice(-4)}`, ...request };
  localRequests.unshift(localRequest);
  await recordActivity({ request_id: localRequest.id, type: 'booking_created', description: `Nouvelle demande de ${localRequest.name}` });
  res.status(201).json({ request: localRequest, realtime: false });
});

app.get('/api/requests', async (req, res) => {
  if (supabase) {
    const { data, error } = await supabase.from('requests').select('*').order('created_at', { ascending: false }).limit(12);
    if (error) return res.status(500).json({ error: supabaseError(error) });
    return res.json({ requests: data, realtime: true });
  }
  res.json({ requests: localRequests, realtime: false });
});

app.get('/api/health', async (req, res) => {
  if (!adminSupabase) return res.status(503).json({ connected: false, realtime: false, mode: 'local', reason: 'Supabase service role key missing or invalid.' });
  const { data, count, error } = await adminSupabase.from('requests').select('id', { count: 'exact' }).limit(1);
  if (error) return res.status(503).json({ connected: false, realtime: false, mode: 'supabase', reason: supabaseError(error) });
  const { error: activitiesError } = await adminSupabase.from('activities').select('id', { head: true }).limit(1);
  if (activitiesError) return res.status(503).json({ connected: false, realtime: false, mode: 'supabase', reason: supabaseError(activitiesError) });
  res.json({ connected: true, realtime: true, mode: 'supabase', tables: ['requests', 'activities'], count: count ?? data?.length ?? 0, message: 'Supabase database, bookings, and activity tables are reachable.' });
});

async function startServer() {
  let databaseStatus = 'local mode';
  let requestsTableReady = false;
  if (adminSupabase) {
    const { error } = await adminSupabase.from('requests').select('id', { count: 'exact', head: true });
    requestsTableReady = !error;
    databaseStatus = error ? `Supabase connected, table error: ${error.message}` : 'Supabase connected and requests table ready';
  }
  app.listen(port, () => {
    console.log(`Mconsulting is live at http://localhost:${port}`);
    console.log(`Database: ${databaseStatus}`);
    console.log(`Realtime: ${requestsTableReady ? 'enabled for requests table' : 'disabled until requests table is ready'}`);
  });
}

startServer();
