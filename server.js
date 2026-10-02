import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

app.use(express.json());

// In-memory store for profile fallback if used
let memoryProfile = {
  uid: 'demo-runner-001',
  email: 'runner@runna.pro',
  displayName: 'Alex Morgan',
  onboarded: true,
  units: 'km',
  baseline5kSeconds: 1590,
  goalDistance: '10k',
  goalAmbition: 'improve',
  experience: 'intermediate',
  frequencyDays: 4,
  preferredDays: ['Tue', 'Thu', 'Sat', 'Sun'],
  planWeeks: 12,
  completedWorkouts: {},
};

// API: Profile
app.get('/api/profile', (req, res) => {
  res.json({ profile: memoryProfile });
});

app.put('/api/profile', (req, res) => {
  memoryProfile = { ...memoryProfile, ...req.body };
  res.json({ profile: memoryProfile });
});

// API: Strava OAuth routes
app.get('/api/strava/connect', (req, res) => {
  const clientId = process.env.STRAVA_CLIENT_ID;
  if (!clientId) {
    return res.redirect('/?strava=not_configured');
  }
  const redirectUri = `${req.protocol}://${req.get('host')}/api/strava/callback`;
  const state = Math.random().toString(36).substring(7);
  const authorizeUrl = `https://www.strava.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=read,activity:read_all&state=${state}`;
  res.redirect(authorizeUrl);
});

app.get('/api/strava/callback', (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.redirect('/?strava=error');
  }
  res.redirect('/?strava=connected');
});

// Static assets
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Server listening at http://${HOST}:${PORT}`);
});
