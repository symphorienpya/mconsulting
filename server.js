require('dotenv').config({ override: true });

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
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
const localContacts = [];
const localProjects = [{ id: 'P-001', title: 'Accompagnement entrepreneurial', client: 'MConsulting', category: 'Conseil', status: 'En cours', progress: 65, description: 'Accompagnement de porteurs de projets vers une structure opérationnelle.', created_at: new Date().toISOString() }];
const localAppointments = [];

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

app.post('/api/admin/requests/bulk-status', requireAdmin, async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(Boolean) : [];
  const status = req.body.status;
  const allowedStatuses = ['Nouvelle demande', 'En découverte', 'Proposition envoyée', 'En cours', 'Terminée'];
  if (!ids.length) return res.status(400).json({ error: 'Sélectionnez au moins une demande.' });
  if (!allowedStatuses.includes(status)) return res.status(400).json({ error: 'Statut invalide.' });
  if (adminSupabase) {
    const { error } = await adminSupabase.from('requests').update({ status }).in('id', ids);
    if (error) return res.status(500).json({ error: supabaseError(error) });
  } else {
    localRequests.filter((item) => ids.includes(item.id)).forEach((item) => { item.status = status; });
  }
  await recordActivity({ type: 'bulk_status_updated', description: `${ids.length} demande(s) déplacée(s) vers « ${status} »` });
  res.json({ ok: true, count: ids.length });
});

app.post('/api/admin/requests/bulk-delete', requireAdmin, async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'Sélectionnez au moins une demande.' });
  if (adminSupabase) {
    const { error } = await adminSupabase.from('requests').delete().in('id', ids);
    if (error) return res.status(500).json({ error: supabaseError(error) });
  } else {
    for (let index = localRequests.length - 1; index >= 0; index -= 1) if (ids.includes(localRequests[index].id)) localRequests.splice(index, 1);
  }
  await recordActivity({ type: 'bulk_request_deleted', description: `${ids.length} demande(s) supprimée(s)` });
  res.json({ ok: true, count: ids.length });
});

app.post('/api/admin/projects/:id/duplicate', requireAdmin, async (req, res) => {
  const source = adminSupabase
    ? (await adminSupabase.from('projects').select('*').eq('id', req.params.id).single()).data
    : localProjects.find((item) => item.id === req.params.id);
  if (!source) return res.status(404).json({ error: 'Projet introuvable.' });
  const payload = { title: `${source.title} - copie`, client: source.client, category: source.category, status: 'Planifié', progress: 0, description: source.description, created_at: new Date().toISOString() };
  if (adminSupabase) {
    const { data, error } = await adminSupabase.from('projects').insert(payload).select().single();
    if (error) return res.status(500).json({ error: supabaseError(error) });
    await recordActivity({ type: 'project_duplicated', description: `Projet dupliqué : ${data.title}` });
    return res.status(201).json({ project: data });
  }
  const project = { id: crypto.randomUUID(), ...payload };
  localProjects.unshift(project);
  await recordActivity({ type: 'project_duplicated', description: `Projet dupliqué : ${project.title}` });
  res.status(201).json({ project });
});

app.delete('/api/admin/requests/:id', requireAdmin, async (req, res) => {
  if (adminSupabase) {
    const { error } = await adminSupabase.from('requests').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: supabaseError(error) });
  } else {
    const index = localRequests.findIndex((item) => item.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: 'Demande introuvable.' });
    localRequests.splice(index, 1);
  }
  await recordActivity({ type: 'request_deleted', description: `Demande supprimée : ${req.params.id}` });
  res.json({ ok: true });
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

app.get('/api/admin/contacts', requireAdmin, async (req, res) => {
  if (adminSupabase) {
    const { data, error } = await adminSupabase.from('contacts').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: supabaseError(error) });
    return res.json({ contacts: data });
  }
  res.json({ contacts: localContacts });
});

app.post('/api/admin/contacts', requireAdmin, async (req, res) => {
  const { name, company = '', email = '', phone = '', role = '', notes = '' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Le nom du contact est requis.' });
  if (adminSupabase) {
    const payload = { name: name.trim(), company, email, phone, role, notes, created_at: new Date().toISOString() };
    const { data, error } = await adminSupabase.from('contacts').insert(payload).select().single();
    if (error) return res.status(500).json({ error: supabaseError(error) });
    await recordActivity({ type: 'contact_created', description: `Contact ajouté : ${data.name}` });
    return res.status(201).json({ contact: data });
  }
  const contact = { id: crypto.randomUUID(), name: name.trim(), company, email, phone, role, notes, created_at: new Date().toISOString() };
  localContacts.unshift(contact);
  await recordActivity({ type: 'contact_created', description: `Contact ajouté : ${contact.name}` });
  res.status(201).json({ contact });
});

app.delete('/api/admin/contacts/:id', requireAdmin, async (req, res) => {
  if (adminSupabase) {
    const { error } = await adminSupabase.from('contacts').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: supabaseError(error) });
  } else {
    const index = localContacts.findIndex((item) => item.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: 'Contact introuvable.' });
    localContacts.splice(index, 1);
  }
  await recordActivity({ type: 'contact_deleted', description: 'Contact supprimé' });
  res.json({ ok: true });
});

app.patch('/api/admin/contacts/:id', requireAdmin, async (req, res) => {
  const { name, company = '', email = '', phone = '', role = '', notes = '' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Le nom du contact est requis.' });
  const payload = { name: name.trim(), company, email, phone, role, notes };
  if (adminSupabase) {
    const { data, error } = await adminSupabase.from('contacts').update(payload).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: supabaseError(error) });
    await recordActivity({ type: 'contact_updated', description: `Contact modifié : ${data.name}` });
    return res.json({ contact: data });
  }
  const contact = localContacts.find((item) => item.id === req.params.id);
  if (!contact) return res.status(404).json({ error: 'Contact introuvable.' });
  Object.assign(contact, payload);
  await recordActivity({ type: 'contact_updated', description: `Contact modifié : ${contact.name}` });
  res.json({ contact });
});

app.get('/api/admin/projects', requireAdmin, async (req, res) => {
  if (adminSupabase) {
    const { data, error } = await adminSupabase.from('projects').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: supabaseError(error) });
    return res.json({ projects: data });
  }
  res.json({ projects: localProjects });
});

app.post('/api/admin/projects', requireAdmin, async (req, res) => {
  const { title, client = '', category = '', status = 'Planifié', progress = 0, description = '' } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Le titre du projet est requis.' });
  const safeProgress = Math.max(0, Math.min(100, Number(progress) || 0));
  if (adminSupabase) {
    const payload = { title: title.trim(), client, category, status, progress: safeProgress, description, created_at: new Date().toISOString() };
    const { data, error } = await adminSupabase.from('projects').insert(payload).select().single();
    if (error) return res.status(500).json({ error: supabaseError(error) });
    await recordActivity({ type: 'project_created', description: `Projet créé : ${data.title}` });
    return res.status(201).json({ project: data });
  }
  const project = { id: crypto.randomUUID(), title: title.trim(), client, category, status, progress: safeProgress, description, created_at: new Date().toISOString() };
  localProjects.unshift(project);
  await recordActivity({ type: 'project_created', description: `Projet créé : ${project.title}` });
  res.status(201).json({ project });
});

app.patch('/api/admin/projects/:id', requireAdmin, async (req, res) => {
  const { title, client = '', category = '', status = 'Planifié', progress = 0, description = '' } = req.body;
  const payload = { title: title?.trim(), client, category, status, progress: Math.max(0, Math.min(100, Number(progress) || 0)), description };
  if (!payload.title) return res.status(400).json({ error: 'Le titre du projet est requis.' });
  if (adminSupabase) {
    const { data, error } = await adminSupabase.from('projects').update(payload).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: supabaseError(error) });
    await recordActivity({ type: 'project_updated', description: `Projet mis à jour : ${data.title}` });
    return res.json({ project: data });
  }
  const project = localProjects.find((item) => item.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Projet introuvable.' });
  Object.assign(project, payload);
  await recordActivity({ type: 'project_updated', description: `Projet mis à jour : ${project.title}` });
  res.json({ project });
});

app.delete('/api/admin/projects/:id', requireAdmin, async (req, res) => {
  if (adminSupabase) {
    const { error } = await adminSupabase.from('projects').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: supabaseError(error) });
  } else {
    const index = localProjects.findIndex((item) => item.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: 'Projet introuvable.' });
    localProjects.splice(index, 1);
  }
  await recordActivity({ type: 'project_deleted', description: 'Projet supprimé' });
  res.json({ ok: true });
});

app.get('/api/projects', async (req, res) => {
  if (adminSupabase) {
    const { data, error } = await adminSupabase.from('projects').select('id,title,client,category,status,progress,description,created_at').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: supabaseError(error) });
    return res.json({ projects: data });
  }
  res.json({ projects: localProjects });
});

function csvValue(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function sendCsv(res, filename, columns, rows) {
  const lines = [columns.map((column) => csvValue(column.label)).join(','), ...rows.map((row) => columns.map((column) => csvValue(row[column.key])).join(','))];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`\ufeff${lines.join('\r\n')}`);
}

app.post('/api/appointments', async (req, res) => {
  const { name, email, phone, company = '', service, appointment_date, appointment_time, mode = 'Présentiel', message = '' } = req.body;
  if (!name || !email || !phone || !service || !appointment_date || !appointment_time) {
    return res.status(400).json({ error: 'Nom, email, téléphone, service, date et heure sont requis.' });
  }
  const payload = { name, email, phone, company, service, appointment_date, appointment_time, mode, message, status: 'Nouvelle demande', created_at: new Date().toISOString() };
  if (adminSupabase) {
    const { data, error } = await adminSupabase.from('appointments').insert(payload).select().single();
    if (error) return res.status(500).json({ error: supabaseError(error) });
    await recordActivity({ type: 'appointment_created', description: `Rendez-vous demandé par ${data.name}` });
    return res.status(201).json({ appointment: data });
  }
  const appointment = { id: crypto.randomUUID(), ...payload };
  localAppointments.unshift(appointment);
  await recordActivity({ type: 'appointment_created', description: `Rendez-vous demandé par ${appointment.name}` });
  res.status(201).json({ appointment });
});

app.get('/api/admin/appointments', requireAdmin, async (req, res) => {
  if (adminSupabase) {
    const { data, error } = await adminSupabase.from('appointments').select('*').order('appointment_date', { ascending: true }).order('appointment_time', { ascending: true });
    if (error) return res.status(500).json({ error: supabaseError(error) });
    return res.json({ appointments: data });
  }
  res.json({ appointments: localAppointments });
});

app.patch('/api/admin/appointments/:id', requireAdmin, async (req, res) => {
  const allowedStatuses = ['Nouvelle demande', 'Confirmé', 'Replanifié', 'Terminé', 'Annulé'];
  if (!allowedStatuses.includes(req.body.status)) return res.status(400).json({ error: 'Statut invalide.' });
  const payload = { status: req.body.status, admin_notes: req.body.admin_notes || '' };
  if (adminSupabase) {
    const { data, error } = await adminSupabase.from('appointments').update(payload).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: supabaseError(error) });
    await recordActivity({ type: 'appointment_updated', description: `Rendez-vous ${data.status.toLowerCase()} : ${data.name}` });
    return res.json({ appointment: data });
  }
  const appointment = localAppointments.find((item) => item.id === req.params.id);
  if (!appointment) return res.status(404).json({ error: 'Rendez-vous introuvable.' });
  Object.assign(appointment, payload);
  await recordActivity({ type: 'appointment_updated', description: `Rendez-vous ${appointment.status.toLowerCase()} : ${appointment.name}` });
  res.json({ appointment });
});

app.delete('/api/admin/appointments/:id', requireAdmin, async (req, res) => {
  if (adminSupabase) {
    const { error } = await adminSupabase.from('appointments').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: supabaseError(error) });
  } else {
    const index = localAppointments.findIndex((item) => item.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: 'Rendez-vous introuvable.' });
    localAppointments.splice(index, 1);
  }
  await recordActivity({ type: 'appointment_deleted', description: 'Rendez-vous supprimé' });
  res.json({ ok: true });
});

app.get('/api/admin/export/:type', requireAdmin, async (req, res) => {
  const type = req.params.type;
  const definitions = {
    requests: { table: 'requests', columns: [['id', 'ID'], ['name', 'Nom'], ['company', 'Organisation'], ['email', 'Email'], ['service', 'Besoin'], ['budget', 'Budget'], ['status', 'Statut'], ['message', 'Message'], ['created_at', 'Créé le']] },
    appointments: { table: 'appointments', columns: [['id', 'ID'], ['name', 'Nom'], ['email', 'Email'], ['phone', 'Téléphone'], ['company', 'Organisation'], ['service', 'Service'], ['appointment_date', 'Date'], ['appointment_time', 'Heure'], ['mode', 'Mode'], ['status', 'Statut'], ['message', 'Message'], ['admin_notes', 'Notes admin'], ['created_at', 'Créé le']] },
    contacts: { table: 'contacts', columns: [['id', 'ID'], ['name', 'Nom'], ['company', 'Organisation'], ['email', 'Email'], ['phone', 'Téléphone'], ['role', 'Fonction'], ['notes', 'Notes'], ['created_at', 'Créé le']] },
    projects: { table: 'projects', columns: [['id', 'ID'], ['title', 'Titre'], ['client', 'Client'], ['category', 'Catégorie'], ['status', 'Statut'], ['progress', 'Avancement'], ['description', 'Description'], ['created_at', 'Créé le']] },
    activities: { table: 'activities', columns: [['id', 'ID'], ['type', 'Type'], ['description', 'Description'], ['request_id', 'Référence'], ['created_at', 'Créé le']] }
  };
  const definition = definitions[type];
  if (!definition) return res.status(400).json({ error: 'Type d’export invalide.' });
  let rows = [];
  if (adminSupabase) {
    const { data, error } = await adminSupabase.from(definition.table).select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: supabaseError(error) });
    rows = data || [];
  } else {
    rows = ({ requests: localRequests, contacts: localContacts, projects: localProjects, appointments: localAppointments, activities: localActivities })[type] || [];
  }
  const columns = definition.columns.map(([key, label]) => ({ key, label }));
  sendCsv(res, `mconsulting-${type}-${new Date().toISOString().slice(0, 10)}.csv`, columns, rows);
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
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MConsulting server running on port ${PORT}`);
    console.log(`Database: ${databaseStatus}`);
    console.log(`Realtime: ${requestsTableReady ? 'enabled for requests table' : 'disabled until requests table is ready'}`);
  });
}

startServer();
