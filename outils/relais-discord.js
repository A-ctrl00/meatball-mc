// Relais Cloudflare Worker pour le bot Meatball MC.
//
// 1. Rôles : reçoit les demandes de changement de rôle du script Google et les transmet à Discord.
// 2. Victoires : commande Discord /victoire (photo + course + circuit + date), postée dans le salon
//    #victoires avec deux boutons. Seuls Alexis et le rôle Président peuvent valider.
//    Le robot GitHub du site récupère ensuite les victoires validées et les met en ligne.
//
// Variables secrètes à créer dans le Worker (Paramètres > Variables et secrets, type "Secret") :
//   DISCORD_BOT_TOKEN : le jeton du bot "Le Gardien des Patchs"
//   RELAIS_CLE        : un mot de passe inventé, le même que dans Apps Script et dans GitHub
//
// Dans le portail développeur Discord (Applications > Le Gardien des Patchs > General Information),
// « Interactions Endpoint URL » = https://meatball-relais.alexis-joube.workers.dev/interactions
// La commande /victoire s'installe toute seule au moment où Discord valide cette adresse.

const SERVEUR = '1487466324937539634'; // seul serveur autorisé
const VALIDEURS = ['675260872326774805']; // Alexis ; le rôle « Président » est ajouté automatiquement
const SHEET_ID = '1xyAVmXsdmOs_8q6jFZkJLd9prrofzAQJ_YlI-Ssf84E';
const GID_TABLEAU = '1538331265'; // TABLEAU_DE_BORD_MC : A Membre, G ID Discord
const GID_VOITURES = '1160347114'; // VOITURES : A Pilote, B Numéro
const API = 'https://discord.com/api/v10';

// Courses proposées dans la commande (25 au maximum). « Officiel iRacing » et « Autre ligue »
// sont comptées à part sur le site ; les ligues de l'équipe sont déjà dans RESULTATS LIGUE.
const COURSES = ['Officiel iRacing', 'IFRN Cup', 'IFRN Access', 'IFRN Ignite', 'IFRN Rookie', 'HRL ARCA',
  'HRL Grand National', 'SBG Legends', 'SBG Indy Winter Cup', 'Virtual Oval', 'EuroAmerican 532', 'Autre ligue'];

const COMMANDE = {
  name: 'victoire',
  description: 'Déclarer une victoire avec sa photo (validée ensuite par Alexis ou le Président)',
  type: 1,
  options: [
    { type: 11, name: 'photo', description: 'La capture de ta victoire', required: true },
    { type: 3, name: 'course', description: 'Course officielle iRacing ou ligue', required: true,
      choices: COURSES.map(c => ({ name: c, value: c })) },
    { type: 3, name: 'circuit', description: 'Le circuit (ex. Kansas)', required: true, max_length: 60 },
    { type: 3, name: 'date', description: 'Date de la course, jj/mm/aaaa (par défaut : aujourd\'hui)', required: false, max_length: 10 },
    { type: 3, name: 'nom_ligue', description: 'Seulement pour « Autre ligue » : le nom de la ligue', required: false, max_length: 60 },
    { type: 3, name: 'mot', description: 'Un petit mot sur ta victoire (facultatif)', required: false, max_length: 300 },
  ],
};

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

async function discord(env, chemin, opts = {}) {
  const headers = { Authorization: 'Bot ' + env.DISCORD_BOT_TOKEN, 'User-Agent': 'DiscordBot (https://meatball-mc.fr, 1.0)', ...(opts.headers || {}) };
  if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.json); }
  const r = await fetch(API + chemin, { method: opts.method || 'GET', headers, body: opts.body });
  const t = r.status === 204 ? '' : await r.text();
  let d = null; try { d = t ? JSON.parse(t) : null; } catch (e) { d = t; }
  if (!r.ok) throw new Error('Discord ' + r.status + ' ' + chemin + ' : ' + t.slice(0, 300));
  return d;
}

// Identité de l'application (id et clé publique), lue une fois avec le jeton du bot
let _appli = null;
async function appli(env) {
  if (!_appli) _appli = await discord(env, '/applications/@me');
  return _appli;
}

async function verifierSignature(env, request, corps) {
  const sig = request.headers.get('X-Signature-Ed25519'), ts = request.headers.get('X-Signature-Timestamp');
  if (!sig || !ts) return false;
  const hex = h => new Uint8Array(h.match(/.{2}/g).map(b => parseInt(b, 16)));
  const cle = hex((await appli(env)).verify_key);
  const donnees = new TextEncoder().encode(ts + corps);
  for (const algo of [{ name: 'Ed25519' }, { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' }]) {
    try {
      const k = await crypto.subtle.importKey('raw', cle, algo, false, ['verify']);
      return await crypto.subtle.verify(algo, k, hex(sig), donnees);
    } catch (e) { /* essai suivant */ }
  }
  return false;
}

async function installerCommande(env) {
  const a = await appli(env);
  return discord(env, `/applications/${a.id}/guilds/${SERVEUR}/commands`, { method: 'PUT', json: [COMMANDE] });
}

async function salonVictoires(env) {
  const salons = await discord(env, `/guilds/${SERVEUR}/channels`);
  const s = salons.find(c => c.type === 0 && /victoire/i.test(c.name));
  if (!s) throw new Error('Salon #victoires introuvable');
  return s.id;
}

async function rolesPresident(env) {
  const roles = await discord(env, `/guilds/${SERVEUR}/roles`);
  return roles.filter(r => /pr[ée]sident/i.test(r.name) && !/vice/i.test(r.name)).map(r => r.id);
}

function lireCSV(t) {
  const lignes = []; let l = [], v = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { v += '"'; i++; } else q = false; } else v += c; }
    else if (c === '"') q = true;
    else if (c === ',') { l.push(v); v = ''; }
    else if (c === '\n') { l.push(v.replace(/\r$/, '')); lignes.push(l); l = []; v = ''; }
    else v += c;
  }
  if (v || l.length) { l.push(v); lignes.push(l); }
  return lignes;
}
async function onglet(gid) {
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`);
  return r.ok ? lireCSV(await r.text()) : [];
}
// Nom du pilote (TABLEAU_DE_BORD_MC, colonne G = ID Discord) et numéro (VOITURES)
async function pilote(idDiscord, nomDiscord) {
  try {
    const [tab, voit] = await Promise.all([onglet(GID_TABLEAU), onglet(GID_VOITURES)]);
    const l = tab.find(r => String(r[6] || '').trim() === idDiscord);
    const nom = l ? String(l[0]).replace(/^[^A-Za-zÀ-ÿ]+/, '').trim() : '';
    if (!nom) return { nom: nomDiscord, num: '' };
    const v = voit.find(r => String(r[0] || '').trim().toLowerCase() === nom.toLowerCase());
    return { nom, num: v ? String(v[1] || '').trim() : '' };
  } catch (e) { return { nom: nomDiscord, num: '' }; }
}

function dateFr(s) {
  if (!s) return new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' });
  const m = String(s).trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/);
  if (!m) return null;
  const j = +m[1], mo = +m[2], a = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  if (j < 1 || j > 31 || mo < 1 || mo > 12) return null;
  return String(j).padStart(2, '0') + '/' + String(mo).padStart(2, '0') + '/' + a;
}

const champ = (e, nom) => ((e.fields || []).find(f => f.name === nom) || {}).value || '';
function avecStatut(e, statut, couleur) {
  const f = (e.fields || []).map(x => x.name === 'Statut' ? { ...x, value: statut } : x);
  return { ...e, fields: f, color: couleur ?? e.color };
}

// /victoire : réponse immédiate (Discord n'attend que 3 secondes), le reste se fait en arrière-plan
async function declarerVictoire(env, it) {
  const o = Object.fromEntries((it.data.options || []).map(x => [x.name, x.value]));
  const att = it.data.resolved?.attachments?.[o.photo];
  const user = it.member?.user || it.user;
  const a = await appli(env);
  const repondre = contenu => discord(env, `/webhooks/${a.id}/${it.token}/messages/@original`, { method: 'PATCH', json: { content: contenu } });
  try {
    if (!att || !/^image\//.test(att.content_type || '')) return repondre('❌ La photo doit être une image (PNG ou JPG).');
    const date = dateFr(o.date);
    if (!date) return repondre('❌ Date illisible. Écris-la comme ceci : 20/09/2026.');
    if (o.course === 'Autre ligue' && !o.nom_ligue) return repondre('❌ Pour « Autre ligue », indique son nom dans `nom_ligue`.');
    const p = await pilote(user.id, it.member?.nick || user.global_name || user.username);
    const course = o.course === 'Autre ligue' ? o.nom_ligue.trim() : o.course;
    const img = await (await fetch(att.url)).arrayBuffer();
    const ext = (att.filename.match(/\.(png|jpe?g|webp)$/i) || ['', 'png'])[1].toLowerCase();
    const fichier = 'victoire.' + ext;
    const embed = {
      title: '🏆 Victoire déclarée',
      description: `<@${user.id}> déclare une victoire.`,
      color: 0xFF6A1A,
      fields: [
        { name: 'Pilote', value: p.nom, inline: true },
        { name: 'Numéro', value: p.num || '–', inline: true },
        { name: 'Course', value: course, inline: true },
        { name: 'Circuit', value: String(o.circuit).trim(), inline: true },
        { name: 'Date', value: date, inline: true },
        { name: 'Type', value: o.course === 'Officiel iRacing' ? 'Officiel' : (o.course === 'Autre ligue' ? 'Autre ligue' : 'Ligue de l\'équipe'), inline: true },
        ...(o.mot ? [{ name: 'Le mot du pilote', value: String(o.mot).trim() }] : []),
        { name: 'Statut', value: '⏳ En attente de validation (Alexis ou Président)' },
      ],
      footer: { text: 'discord:' + user.id },
    };
    const form = new FormData();
    form.append('payload_json', JSON.stringify({
      embeds: [embed],
      attachments: [{ id: 0, filename: fichier }],
      components: [{ type: 1, components: [
        { type: 2, style: 3, label: 'Valider', emoji: { name: '✅' }, custom_id: 'vic_ok' },
        { type: 2, style: 4, label: 'Refuser', emoji: { name: '✖️' }, custom_id: 'vic_non' },
      ] }],
      allowed_mentions: { parse: [] },
    }));
    form.append('files[0]', new Blob([img], { type: att.content_type }), fichier);
    const salon = await salonVictoires(env);
    await discord(env, `/channels/${salon}/messages`, { method: 'POST', body: form });
    return repondre(`✅ Merci ! Ta victoire est postée dans <#${salon}> et attend la validation d'Alexis ou du Président.`);
  } catch (e) {
    console.log(e.stack || e);
    return repondre('❌ Problème pendant l\'envoi, réessaie dans un moment.');
  }
}

async function bouton(env, it) {
  const user = it.member?.user || it.user;
  const roles = it.member?.roles || [];
  const ok = VALIDEURS.includes(user.id) || (await rolesPresident(env)).some(r => roles.includes(r));
  if (!ok) return json({ type: 4, data: { flags: 64, content: 'Seuls Alexis et le Président peuvent valider ou refuser une victoire.' } });
  const e = it.message.embeds[0];
  const nom = it.member?.nick || user.global_name || user.username;
  const valide = it.data.custom_id === 'vic_ok';
  const nouveau = valide ? avecStatut(e, `✅ Validée par ${nom}, mise en ligne sur le site dans le quart d'heure`, 0x43A047)
                         : avecStatut(e, `✖️ Refusée par ${nom}`, 0x5f6b7a);
  return json({ type: 7, data: { embeds: [nouveau], components: [] } });
}

// Routes pour le robot GitHub du site (protégées par RELAIS_CLE)
async function victoiresValidees(env) {
  const a = await appli(env);
  const salon = await salonVictoires(env);
  const msgs = await discord(env, `/channels/${salon}/messages?limit=100`);
  return msgs.filter(m => m.author?.id === a.id && m.embeds?.[0] && m.attachments?.[0])
    .filter(m => { const s = champ(m.embeds[0], 'Statut'); return s.startsWith('✅') && !s.includes('📌'); })
    .map(m => {
      const e = m.embeds[0];
      return { id: m.id, image: m.attachments[0].url, fichier: m.attachments[0].filename,
        pilote: champ(e, 'Pilote'), num: champ(e, 'Numéro').replace('–', ''), course: champ(e, 'Course'),
        circuit: champ(e, 'Circuit'), date: champ(e, 'Date'), type: champ(e, 'Type'), mot: champ(e, 'Le mot du pilote') };
    });
}
async function marquerPubliee(env, id) {
  const salon = await salonVictoires(env);
  const m = await discord(env, `/channels/${salon}/messages/${id}`);
  const e = m.embeds[0];
  const s = champ(e, 'Statut').replace(/, mise en ligne.*$/, '');
  await discord(env, `/channels/${salon}/messages/${id}`, { method: 'PATCH', json: { embeds: [avecStatut(e, s + ' · 📌 En ligne sur meatball-mc.fr')] } });
  return { ok: true };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') return new Response('Relais Meatball MC', { status: 405 });
    const url = new URL(request.url);

    // ----- Interactions Discord (commande /victoire et boutons) -----
    if (url.pathname === '/interactions') {
      const corps = await request.text();
      if (!(await verifierSignature(env, request, corps))) return new Response('signature invalide', { status: 401 });
      const it = JSON.parse(corps);
      if (it.type === 1) { // PING : Discord vérifie l'adresse, on en profite pour installer la commande
        ctx.waitUntil(installerCommande(env).catch(e => console.log('installation : ' + e.message)));
        return json({ type: 1 });
      }
      if ((it.guild_id || SERVEUR) !== SERVEUR) return json({ type: 4, data: { flags: 64, content: 'Serveur non autorisé.' } });
      if (it.type === 2 && it.data.name === 'victoire') {
        ctx.waitUntil(declarerVictoire(env, it));
        return json({ type: 5, data: { flags: 64 } });
      }
      if (it.type === 3 && /^vic_(ok|non)$/.test(it.data.custom_id)) return bouton(env, it);
      return json({ type: 4, data: { flags: 64, content: 'Commande inconnue.' } });
    }

    // ----- Appels du script Google et du robot GitHub -----
    if (!env.RELAIS_CLE || request.headers.get('X-Relais-Cle') !== env.RELAIS_CLE) {
      return json({ code: 0, message: 'cle du relais invalide' }, 401);
    }
    let d;
    try { d = await request.json(); } catch (e) {
      return json({ code: 0, message: 'JSON invalide' }, 400);
    }
    try {
      if (d.action === 'victoires_validees') return json(await victoiresValidees(env));
      if (d.action === 'victoire_publiee') return json(await marquerPubliee(env, String(d.id || '').replace(/\D/g, '')));
      if (d.action === 'installer_commande') return json(await installerCommande(env));
    } catch (e) {
      return json({ code: 0, message: e.message }, 502);
    }

    // Rôles de grade et de division (script Google)
    const methode = String(d.methode || '').toUpperCase();
    const chemin = String(d.chemin || '');
    const ok = (methode === 'PUT' || methode === 'DELETE') &&
      new RegExp('^/guilds/' + SERVEUR + '/members/\\d+/roles/\\d+$').test(chemin);
    if (!ok) return json({ code: 0, message: 'requete refusee par le relais' }, 400);

    const r = await fetch(API + chemin, {
      method: methode,
      headers: {
        Authorization: 'Bot ' + env.DISCORD_BOT_TOKEN,
        'User-Agent': 'DiscordBot (https://meatball-mc.fr, 1.0)',
        'X-Audit-Log-Reason': encodeURIComponent(String(d.raison || 'Meatball MC')),
      },
    });
    const corps = r.status === 204 ? null : await r.text();
    return new Response(corps, { status: r.status, headers: { 'Content-Type': 'application/json' } });
  },
};
